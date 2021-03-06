var async = require('async');
var test = require('tap').test;
var constants = require('mysql');
var mysql = require('../lib/mysql');
var migrations = require('../lib/migrations');
var migrationDirFiles = require('fs').readdirSync(migrations.dir).sort();

function up(options) {
  return function(callback) { migrations.up(options, callback); };
}

function down(options) {
  return function(callback) { migrations.down(options, callback); };
}

function sqlError(sql, t, error) {
  return function(callback) {
    mysql.client.query(sql, function(err, results) {
      if (!err)
        throw new Error("expected " + sql + " to throw error");
      t.equal(err.number, constants[error],
              "'" + sql + "' should result in " + error + " (" +
              constants[error] + ")");
      callback(null);
    });
  };
}

function sql(sql, testFunc) {
  return function(callback) {
    mysql.client.query(sql, function(err, results) {
      if (err) throw err;
      if (testFunc)
        testFunc(results);
      callback(null);
    });
  };
}

function findMigration(name) {
  var filename, candidate;
  var previous = null;
  
  for (var i = 0; i < migrationDirFiles.length; i++) {
    filename = migrationDirFiles[i];
    match = filename.match(/^([0-9]+)-(.*)\.js$/);
    if (match) {
      candidate = match[1] + '-' + match[2];
      if (match[2] == name)
        return {previous: previous, id: candidate};
      previous = candidate;
    }
  }
  throw new Error("migration not found: " + name);
}

function testMigration(name, getSeries) {
  var migration = findMigration(name);
  var series = [
    mysql.dropTestDatabase,
    mysql.createTestDatabase,
    mysql.useTestDatabase
  ];
  
  if (!migration.previous)
    migration.previous = "empty database";

  test("migration from " + migration.previous + " to " +
       migration.id + " and back works", function(t) {
    series = series.concat(getSeries(t, migration.id, migration.previous));
    async.series(series, function(err) {
      if (err) throw err;
      mysql.client.destroy();
      t.end();
    });
  });
}

testMigration("initial", function(t, id) {
  return [
    up({destination: id}),
    sql("SELECT * FROM migrations", function(results) {
      t.equal(results.length, 1, "one migration occurred");
      t.same(results[0].name, id, "migration name is " + id);
    }),
    sql("SELECT * FROM user", function(results) {
      t.equal(results.length, 0, "user table exists and has no entries");
    }),
    down({count: 1}),
    sql("SELECT * FROM migrations", function(results) {
      t.equal(results.length, 0, id + " was rolled back");
    }),
    sqlError("SELECT * FROM user", t, "ERROR_NO_SUCH_TABLE")
  ];
});

testMigration("add-public-columns", function(t, id, previousId) {
  return [
    up({destination: previousId}),
    sql("INSERT INTO `user` VALUES (1,'foo@bar.org',NULL,1,NULL,NULL);"),
    sql("INSERT INTO `badge` VALUES (1,1,'hosted','http://foo',NULL,NULL," +
        "'/blah.png',0,'i am a json assertion','i am a json assertion hash'" +
        ",now());"),
    up({count: 1}),
    sql("SELECT public, public_path FROM badge " +
        "WHERE endpoint='http://foo'", function(results) {
      t.equal(results[0].public, 0, "'public' defaults to false");
      t.equal(results[0].public_path, null, "'public_path' defaults to null");
    }),
    down({count: 1}),
    sqlError("SELECT public_path FROM badge", t, "ERROR_BAD_FIELD_ERROR"),
    sqlError("SELECT public FROM badge", t, "ERROR_BAD_FIELD_ERROR")
  ];
});
