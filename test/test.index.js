/**
 * Created by martin on 15.03.14.
 */

var sync = websqlSync({
  db: openDatabase('test', '0.1', 'Test DB', 5*1024*1024),
  tableName: 'todos',
  url: 'test.response.js'
});

var todos = [
  {value: 'foo', id: 1},
  {value: 'bar', id: 2},
  {value: 'baz', id: 3}
];

function flush(cb){
  websqlSync.orm.del('todos', null, null, function(err, res, tx){
    websqlSync.orm.del('_events', null, tx, function(err){
      websqlSync.orm.del('_lastSync', null, tx, function(err){
        cb();
      });
    });
  });
}

describe('websqlSync', function(){

  before(function(done){
    sync.init(function(){
      websqlSync.orm.query('CREATE TABLE IF NOT EXISTS todos ' +
        '(id TEXT PRIMARY KEY, value TEXT)', null, function(err, res){
        sync.initTriggers(function(){
          done();
        });
      });
    });
  });

  after(function(done){
    websqlSync.orm.query('DROP TABLE _lastSync', null, function(err, res, tx){
      websqlSync.orm.query('DROP TABLE _events', tx, function(err, res, tx){
        websqlSync.orm.query('DROP TABLE todos', tx, function(err, res, tx){
          done();
        });
      });
    });
//    flush(done);
  });

  beforeEach(function(done){
    flush(done);
  });

  describe('orm', function(){

    it('insert should insert data', function(done){
      websqlSync.orm.insert('todos', {id: 'foo', value: 'bar'}, null, function(err, res){
        expect(res.rowsAffected).to.be.eql(2); // insert + trigger insert
        done();
      });
    });

    it('query should make given sql query', function(done){
      websqlSync.orm.insert('todos', {id: 'foo', value: 'baz'}, null, function(err, res, tx){
        websqlSync.orm.query('SELECT * FROM todos WHERE id = "foo"', tx, function(err, res){
          expect(res.rows.length).to.be.eql(1);
          done();
        });
      });
    });

    it('select should select data', function(done){
      websqlSync.orm.insert('todos', todos, null, function(err, res, tx){
        websqlSync.orm.select('todos', 'id = 2', tx, function(err, res){
          expect(res.rows.length).to.be.eql(1);
          done();
        });
      });
    });

    it('delete should delete data', function(done){
      websqlSync.orm.insert('todos', todos, null, function(err, res, tx){
        websqlSync.orm.select('todos', null, tx, function(err, res, tx){
          expect(res.rows.length).to.be(3);
          websqlSync.orm.del('todos', 'id = 2', tx, function(err, res, tx){
            expect(err).to.be(null);
            websqlSync.orm.select('todos', null, tx, function(err, res, tx){
              expect(res.rows.length).to.be(2);
              done();
            });
          });
        });
      });
    });
  });

  describe('events to be synced', function(){
    describe('events', function(){

      it('should save event to queue', function(done){
        websqlSync.orm.insert('todos', todos[0], null, function(err, res, tx){
          websqlSync.orm.select('_events', '',tx, function(err, res, tx){
            expect(res.rows.length).to.be.eql(1);
            done();
          });
        });
      });

      it('should save multiple events after various actions', function(done){
        websqlSync.orm.insert('todos', todos[0], null, function(err, res, tx){
          websqlSync.orm.insert('todos', todos[1], null, function(err, res, tx){
            websqlSync.orm.del('todos', 'id = 2', null, function(err, res, tx){
              websqlSync.orm.select('_events', '', tx, function(err, res, tx){
                expect(res.rows.length).to.be.eql(3);
                done();
              });
            });
          });
        });
      });
    });

    describe('last sync', function(){

      it('should save last sync timestamp', function(done){
        var lastSync = (new Date).getTime();
        websqlSync.orm.insert('_lastSync', {ts: lastSync}, null, function(err, res){
          expect(err).to.be(null);
          done();
        });
      });
    });
  });

  describe('websqlSync', function(){
    sync.url = 'test.response.json';

    beforeEach(function(done){
      websqlSync.orm.insert('_lastSync', {ts: 10}, null, function(err, res, tx){
        done();
      });
    });

    it('should compose payload for server correctly', function(done){
      websqlSync.orm.insert('todos', todos, null, function(err, res, tx){
        sync.makePayload(function(err, pay){
          expect(pay.updates.length).to.be(3);
          expect(pay).to.have.property('since');
          done();
        });
      });
    });

    it('should synchronize', function(done){
      // inserting 1,2,3 items, thus there should be 3 _events
      websqlSync.orm.insert('todos', todos, null, function(err, res, tx){
        // we assume 1,2,3 are synced so we delete this events
        websqlSync.orm.del('_events', 'id IN (1, 2, 3)', tx, function(err, res, tx){
          websqlSync.orm.query('UPDATE todos SET value="bla" WHERE id=1', tx, function(err, res, tx){
//            console.log(err, res, tx)
            websqlSync.orm.del('todos', 'id=2', tx, function(err, res, tx){
//              console.log(err, res, tx)
              websqlSync.orm.select('_events', null, tx, function(err, res, tx){
//                console.log(err, res, tx)
                expect(res.rows.length).to.be(2);
                sync.sync(function(err, res, tx){
//                  console.log(err, res, tx)
                  websqlSync.orm.select('todos', null, tx, function(err, res, tx){
//                    console.log(err, res, tx)
                    expect(res.rows.length).to.be(2);
                    expect(res.rows.item(1).value).to.be('beep');
//                    for(var i=0; i<res.rows.length; i++){
//                      console.log(res.rows.item(i))
//                    }
                    websqlSync.orm.select('_lastSync', null, tx, function(err, res){
                      expect(res.rows.item(0).ts).to.be(1394892664128);
                      websqlSync.orm.select('_events', null, tx, function(err, res){
                        expect(res.rows.length).to.be(0);
                        done();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
