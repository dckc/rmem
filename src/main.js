/* global require, module */

// @flow

const { EventEmitter } = require('events');

const bodyParser = require('body-parser');
const { docopt } = require('docopt');
const requireText = require('require-text');
const session = require('express-session');
const { Router } = require('express');

const homePage = requireText('./tpl/index.html', require);
const registerPage = requireText('./tpl/register.html', require);
const def = Object.freeze;

const usage = `
Usage:
  main.js [options] createdb
  main.js [options] start

Options:
 --db=URI               DB URI [default: sqlite:rchain-membership.db]
 --dialect=NAME         DB dialect [default: sqlite]
 --port=N               HTTP port [default: 3000]
 -h --help              show usage

`;


function main(argv, { uuid4, express, Sequelize }) {
  const cli = docopt(usage, { argv: argv.slice(2) });
  const app = express();

  console.log('@@DEBUG: cli:', cli);
  const sequelize = new Sequelize(cli['--db'], { dialect: cli['--dialect'] });
  const rmem = Membership(sequelize, Sequelize);
  const site = Site(sequelize, Sequelize);

  if (cli.createdb) {
    site.createSchema(uuid4());
    rmem.createSchema();
  } else if (cli.start) {
    const port = parseInt(cli['--port'], 10);

    site.getSecret().then((secret) => {
      const store = site.sessionStore();
      app.use(session({
        store,
        secret,
        generate: uuid4,
        saveUninitialized: false,
        resave: false,
      }));

      app.use('/', rmem.router());
    });


    app.listen(port, () => console.log(`Example app listening on port ${port}!`));
  }
}


/**
 * A Site has an app secret and a collections of sessions.
 *
 * ISSUE: TODO: prune expired sessions.
 */
function Site(sequelize, DTypes) {
  const App = sequelize.define('app', { secret: DTypes.STRING });
  const Session = sequelize.define('session', {
    sid: { type: DTypes.STRING, primaryKey: true },
    state: { type: DTypes.JSON },
  });

  function createSchema(secret) /*: Promise<*> */ {
    return Promise.all([
      App.sync(/* ISSUE: force? */).then(() => App.create({ secret, id: 1 })),
      Session.sync(/* ISSUE: force? */),
    ]);
  }

  function getSecret() {
    return App.findById(1).then(app => app.secret);
  }

  /**
   * cf. https://www.npmjs.com/package/express-session
   */
  function sessionStore() {
    function set(sid, state, next) {
      sequelize.transaction((_t) => {
        const sP = Session.findOrCreate(sid);
        p2c(next, sP.then(([record, _created]) => record.update({ state })));
      });
    }

    function get(sid, next) {
      p2c(next, Session.findById(sid));
    }

    function touch(sid, next) {
      const sP = Session.findById(sid);
      p2c(next, sP.then(record => record.save()));
    }

    const emitter = new EventEmitter();
    const self = { set, get, touch, on: (...args) => emitter.on(...args) };

    // ISSUE: express-session writes to self.generate
    // return def(self);
    return self;
  }

  return def({ createSchema, getSecret, sessionStore });
}


/**
 * Send result of promise to callback.
 */
function p2c(callback, promise) {
  promise
    .then(result => callback(null, result))
    .catch(oops => callback(oops));
}


function Membership(sequelize, DTypes) {
  const Member = sequelize.define('member', { name: { type: DTypes.STRING } });

  function createSchema() /*: Promise<void> */ {
    return Member.sync(/* ISSUE: force? */);
  }

  function register(req /*: express$Request */, res) {
    sequelize
      .authenticate()
      .then(() => {
        console.log('register: DB authenticated');
        // $FlowFixMe
        const { name } = req.body;
        Member.create({ name })
          .then(() => {
            res.send(`<p>Welcome, ${name}</p>`); // ISSUE: templates?
          });
      });
  }

  function router() {
    const it = Router();
    const urlencodedParser = bodyParser.urlencoded({ extended: false });

    it.get('/', page(homePage));
    // ISSUE: `/register` magic string
    // should (statically) extract from homePage
    it.get('/register', page(registerPage));
    // ISSUE: csrf
    it.post('/register', urlencodedParser, register);
    return it;
  }

  return def({ createSchema, router, register });
}


function page(txt) /*: express$Middleware*/ {
  return (req /*: express$Request */, res, _next) => res.send(txt);
}


if (require.main === module) {
  // Access ambient stuff only when invoked as main module.
  /* eslint-disable global-require */
  /* global process */
  main(process.argv, {
    express: require('express'),
    Sequelize: require('sequelize'),
    uuid4: require('uuid4'),
  });
}
