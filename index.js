(function(){

  function postJSON(uri, data, callback) {
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open("POST", uri, true);
    xmlHttp.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
    xmlHttp.onreadystatechange = function() {
      if(xmlHttp.readyState==4 && xmlHttp.status==200) {
        return callback(null, JSON.parse(xmlHttp.responseText));
      }
    };
    xmlHttp.send(data);
  };

  var syncer = window.syncer = function(opts){
    syncer.db = opts.db;
    return new Syncer(opts);
  }

  syncer.orm = {

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

      function insert(tx){
        var error = null
          , result = null
          , i = values.length;
          ;

        values.forEach(function(v){

          var sql = 'INSERT INTO '+table+' ('+cols.join(',')+') ' +
            'VALUES '+'("'+v.join('","')+'")';

          tx.executeSql(sql, null,
            function success(tx, res){
              i--;
              error = null;
              result = res;
              if(i === 0) cb(error, result, tx);
            },
            function error(tx, err){
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
        return syncer.db.transaction(function(tx){
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
        return syncer.db.transaction(function(tx){
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
        return syncer.db.transaction(function(tx){
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
        return syncer.db.transaction(function(tx){
          return select(tx);
        })
      }
    }
  }

  function Syncer(opts){
    this.opts = opts || {};
    this.url = opts.url || '';
    this.idCol = opts.id || 'id';
    this.tableName = this.opts.tableName;
    if(!this.tableName) throw Error('syncer ~> missing table name in options');
  }

  Syncer.prototype.init = function(cb){
    syncer.db.transaction(function(tx){
      // @todo add TS
      tx.executeSql('CREATE TABLE IF NOT EXISTS _events' +
          ' (id TEXT, cmd TEXT)', null);
      tx.executeSql('CREATE TABLE IF NOT EXISTS _lastSync' +
        ' (ts TIMESTAMP)', null);
      tx.executeSql('INSERT INTO _lastSync (ts) VALUES (1)', null);
      tx.executeSql('SELECT * FROM _lastSync', null);
//      setTimeout(cb, 1);
      return cb();
    });
  };

  Syncer.prototype.initTriggers = function(cb){
    var self = this
      ;
    syncer.db.transaction(function(tx){
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
//      setTimeout(cb, 100);
    });
  };

  Syncer.prototype.makePayload = function(cb){
    var payload = {
      updates: []
    };

    syncer.orm.query('SELECT * FROM _events', null, function(err, res, tx){
      if(err) return cb(err);

      for(var i=0; i<res.rows.length; i++){
        payload.updates.push(res.rows.item(i));
      }

      syncer.orm.query('SELECT * FROM _lastSync', tx, function(err, res, tx){
        if(err) return cb(err, null, tx);

        // never synced
        if(res.rows.length === 0) payload.since = 0;
        else payload.since = res.rows.item(0).ts;

        cb(null, payload, tx);
      });
    });
  };

  Syncer.prototype.sync = function(cb){
    var self = this;

    self.makePayload(function(err, payload, tx){

      // ids of affected items since last sync
      var ids = payload.updates.map(function(i){
        return i.id;
      });

      postJSON(self.url, payload, function(err, serverResponse){
        if(err) return cb(err, null, tx);

        // we need new transaction, because this one wouldn't last through xhr
        syncer.orm.del('todos', 'id IN ("'+ids.join('","')+'")',
          null, function(err, res, tx){
            syncer.orm.insert('todos', serverResponse.updates, tx, function(err, res, tx){
              syncer.orm.query('UPDATE _lastSync SET ts='
                + serverResponse.serverTime, tx, function(err, res, tx){

                // @fix we shouldn't delete events added during sinc, thus we need
                // track them by id, or timestamp
                syncer.orm.del('_events', '', tx, function(err, res, tx){
                  return cb(null, res, tx);
                });
              });
            });
        });
      });
    });
  };
})();