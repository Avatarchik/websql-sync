;(function(){

  function postJSON(uri, data, callback) {
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open("POST", uri, true);
    xmlHttp.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
    xmlHttp.onreadystatechange = function() {
      if(xmlHttp.readyState==4 && xmlHttp.status==200) {
        return callback(null, JSON.parse(xmlHttp.responseText));
      }
    };
    xmlHttp.send(typeof data === "string" ? data : JSON.stringify(data));
  };

  window.websqlSync = function(opts){
    Syncer.db = opts.db;
    return new Syncer(opts);
  }

  Syncer.orm = {

    /**
     * insert helper
     *  - orm.insert('tableName', {id: 1, val: 'foo'}, null, cb)
     * @param {String} table
     * @param {Object | Array} data
     * @param {SQLTransaction} transaction
     * @param {Function} cb
     */
    insert: function(table, data, transaction, cb){

      if(!(data instanceof Array)){
        data = [data];
      }

      var cols = [];
      var values = [];

      for(var i=0; i<data.length; i++){
        var obj = data[i];
        values[i] = [];
        for(var p in obj){
          if(obj.hasOwnProperty(p)){
            if(i === 0) cols.push(p);
            values[i].push(obj[p]);
          }
        }
      }

      if(values.length === 0) return cb(null, null, transaction);

      function insert(tx){
        var error = null
          , result = null
          , i = values.length;
          ;

        values.forEach(function(v){

          var sql = 'INSERT OR REPLACE INTO '+table+' ('+cols.join(',')+') ' +
            'VALUES '+'("'+v.join('","')+'")';

          tx.executeSql(sql, null,
            function(tx, res){
              i--;
              error = null;
              result = res;
              if(i === 0) cb(error, result, tx);
            },
            function(tx, err){
              i--;
              error = err;
              if(i === 0) cb(error, result, tx);
            }
          );
//          console.log('returning', result);
//          return cb(error, result, tx);
        });
      }

      if(transaction){
        return insert(transaction);
      } else {
        return Syncer.db.transaction(function(tx){
          return insert(tx);
        })
      }
    },

    /**
     * delete helper
     *  - orm.del('tableName', 'id = 1', null, cb)
     * @param {String} table
     * @param {String} constraints
     * @param {SQLTransaction} transaction
     * @param {Function} cb
     * @returns {*}
     */
    del: function(table, constraints, transaction, cb){

      constraints = constraints ? ' WHERE '+constraints : '';

      function del(tx){
        tx.executeSql('DELETE FROM '+table+constraints+';',
          null,
          function success(tx, res){
            if(cb) cb(null, res, tx);
          },
          function error(tx, err){
            if(cb) cb(err, null, tx);
          }
        )
      }

      if(transaction){
        return del(transaction);
      } else {
        return Syncer.db.transaction(function(tx){
          return del(tx);
        })
      }
    },

    /**
     * executes given query
     * @param {String} sql
     * @param {SQLTransaction} transaction
     * @param {Function} cb
     * @returns {*}
     */
    query: function(sql, transaction, cb){

      function query(tx){
        tx.executeSql(sql,
          null,
          function success(tx, res){
            if(cb) cb(null, res, tx);
          },
          function error(tx, err){
            if(cb) cb(err, null, tx);
          }
        )
      }

      if(transaction){
        return query(transaction);
      } else {
        return Syncer.db.transaction(function(tx){
          return query(tx);
        })
      }
    },

    /**
     * select helper
     * @param {String} table
     * @param {String} constraints
     * @param {SQLTransaction} transaction
     * @param {Function} cb
     * @returns {*}
     */
    select: function(table, constraints, transaction, cb){

      constraints = constraints ? ' WHERE '+constraints : '';

      function select(tx){
        tx.executeSql('SELECT * FROM '+table+constraints+';',
          null,
          function success(tx, res){
            if(cb) cb(null, res, tx);
          },
          function error(tx, err){
            if(cb) cb(err, null, tx);
          }
        )
      }

      if(transaction){
        return select(transaction);
      } else {
        return Syncer.db.transaction(function(tx){
          return select(tx);
        })
      }
    },
    uuid: function (){
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
      });
    }
  }

  function Syncer(opts){
    this.opts = opts || {};
    this.url = opts.url || '';
    this.idCol = opts.id || 'id';
    this.tableName = this.opts.tableName;
    if(!this.tableName) throw Error('Syncer ~> missing table name in options');
  }

  Syncer.prototype.init = function(cb){
    Syncer.db.transaction(function(tx){
      tx.executeSql('CREATE TABLE IF NOT EXISTS _events' +
          ' (id TEXT, cmd TEXT)', null);
      tx.executeSql('CREATE TABLE IF NOT EXISTS _lastSync' +
        ' (id VARCHAR(2) PRIMARY KEY UNIQUE, ts TIMESTAMP)', null);
      return cb();
    });
  };

  Syncer.prototype.initTriggers = function(cb){
    var self = this
      ;
    Syncer.db.transaction(function(tx){
      tx.executeSql('CREATE TRIGGER IF NOT EXISTS update_events_for_'+self.tableName+
        ' AFTER UPDATE ON '+self.tableName+' BEGIN ' +
        ' INSERT INTO _events (id, cmd) VALUES (new.'+self.idCol+', "upsert"); END;', null);
      tx.executeSql('CREATE TRIGGER IF NOT EXISTS insert_events_for_'+self.tableName+
        ' AFTER INSERT ON '+self.tableName+' BEGIN ' +
        ' INSERT INTO _events (id, cmd) VALUES (new.'+self.idCol+', "upsert"); END;', null);
      tx.executeSql('CREATE TRIGGER IF NOT EXISTS delete_events_for_'+self.tableName+
        ' AFTER DELETE ON '+self.tableName+' BEGIN ' +
        ' INSERT INTO _events (id, cmd) VALUES (old.'+self.idCol+', "delete"); END;', null);
      return cb();
    });
  };


  Syncer.prototype.makePayload = function(cb){
    var payload = {
      upserts: [],
      deletes: []
    };

    Syncer.orm.query('SELECT * FROM '+this.tableName+' WHERE id IN' +
      ' (SELECT id FROM _events WHERE cmd LIKE "upsert")',
      null, function(err, res, tx){

        if(err) return cb(err, res);

        for(var i=0; i<res.rows.length; i++){
          payload.upserts.push(res.rows.item(i));
        }

        Syncer.orm.select('_events', 'cmd LIKE "delete"',tx,
          function(err, res, tx){

            if(err) return cb(err, res);

            for(var i=0; i<res.rows.length; i++){
              payload.deletes.push(res.rows.item(i));
            }

            Syncer.orm.query('SELECT * FROM _lastSync WHERE id LIKE "id" LIMIT 1', tx,
              function(err, res, tx){

              if(err) return cb(err, null, tx);

              // never synced
              if(res.rows.length === 0) payload.since = 0;
              else payload.since = res.rows.item(0).ts;

              cb(null, payload, tx);
            });
          });
      });
  };

  Syncer.prototype.doRequest = function(payload, cb){
    var self = this;

    window.websqlSync.postJSON(self.url, payload, function(err, serverResponse){
      return cb(err, payload, serverResponse);
    });
  };

  Syncer.prototype.processResponse = function(err, payload, serverResponse, cb){
    var self = this;

    // ids of affected items since last sync
    var ids = payload.upserts.map(function(i){
      return i.id;
    });

    // we need new transaction, because this one wouldn't last through xhr
    Syncer.orm.del(self.tableName, 'id IN ("'+ids.join('","')+'")',
      null, function(err, res, tx){
        if(err) return cb(err, null);

        Syncer.orm.insert(self.tableName, serverResponse.upserts, tx, function(err, res, tx){
          if(err) return cb(err, null);

          Syncer.orm.del(self.tableName, self.idCol+' IN ("'+
            serverResponse.deletes.map(function(i){ return i.id; }).join('","')+'")', tx, function(err, res, tx){
            if(err) return cb(err, null);

            Syncer.orm.query('INSERT OR REPLACE INTO _lastSync (id, ts) VALUES ("id","'
              + serverResponse.serverTime+'")', tx, function(err, res, tx){
              if(err) return cb(err, null);

              // @fix we shouldn't delete events added during sinc, thus we need
              // track them by id, or timestamp
              Syncer.orm.del('_events', '', tx, function(err, res, tx){
                return cb(err, res, tx);
              });
            });
          });
        });
      });
  };

  Syncer.prototype.sync = function(cb){
    var self = this;

    self.makePayload(function(err, payload, tx){
      self.doRequest(payload, function(err, payload, response){
        self.processResponse(err, payload, response, function(err, res, tx){
          return cb(err, res, tx);
        });
      });
    });
  };

  window.websqlSync.postJSON = postJSON;
  window.websqlSync.orm = Syncer.orm;
  window.websqlSync.db = Syncer.db;
})();