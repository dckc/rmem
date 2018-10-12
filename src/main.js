/* global require, module */

// @flow

const bodyParser = require('body-parser');
const { docopt } = require('docopt');
const requireText = require('require-text');
const Mustache = require('mustache');
const { Router } = require('express');
const cookieParser = require('cookie-parser');
const connectSessionSequelize = require('connect-session-sequelize');

const urlencodedParser = bodyParser.urlencoded({ extended: false });
// We treat requireText as a "link time" operation, not a powerful capability.
const homePage = requireText('./tpl/index.html', require);
const registerPage = requireText('./tpl/register.html', require);
const def = Object.freeze;
const membershipAgreement = {
  text: requireText('./tpl/Coop_Membership_Agreement.md', require),
  revisionDate: new Date('2017-11-17'),
  revisionHash: '8c033fb',
  contentLength: 19054,
};

const usage = `
Usage:
  main.js [options] createdb
  main.js [options] start

Options:
 --db=URI               DB URI [default: sqlite:rchain-membership.db]
 --dialect=NAME         DB dialect [default: sqlite]
 --port=N               HTTP port [default: 3000]
 --logging              log database statements
 -h --help              show usage

`;


function main(argv, { uuid4, express, Sequelize, session, csrf }) {
  const cli = docopt(usage, { argv: argv.slice(2) });

  console.log('CLI configuration:', argv, cli);
  const sequelize = new Sequelize(cli['--db'], {
    dialect: cli['--dialect'],
    logging: cli['--logging'],
  });
  const site = Site(sequelize, Sequelize);
  const agreements = Agreements(sequelize, Sequelize);

  if (cli.createdb) {
    site.createSchema(uuid4(), session);
    agreements.createSchema();
  } else if (cli.start) {
    const app = express();
    const port = parseInt(cli['--port'], 10);

    sequelize
      .authenticate()
      .then(() => {
        console.log('register: DB authenticated');

        site.getSecret().then((secret) => {
          app.use(cookieParser());
          app.use(session({
            secret,
            store: site.sessionStore(session),
            resave: false, // not needed when touch() is supported
            saveUninitialized: false,
            proxy: true, // ISSUE: if you do SSL outside of node.
          }));

          app.use('/', agreements.router(csrf()));
        });
      });

    app.listen(port, () => console.log(`Listening on port ${port}...`));
  }
}


/**
 * A Site has an app secret and a collections of sessions.
 *
 * ISSUE: TODO: prune expired sessions.
 */
function Site(sequelize, DTypes) {
  const App = sequelize.define('app', { secret: DTypes.STRING });

  function sessionStore(session) {
    const SequelizeStore = connectSessionSequelize(session.Store);

    return new SequelizeStore({ db: sequelize });
  }

  function createSchema(secret, session) /*: Promise<*> */ {
    return Promise.all([
      App.sync(/* ISSUE: force? */).then(() => App.create({ secret, id: 1 })),
      sessionStore(session).sync(/* ISSUE: force? */),
    ]);
  }

  function getSecret() {
    return App.findById(1).then(app => app.secret);
  }

  return def({ createSchema, getSecret, sessionStore });
}


/**
 * Executing the membership agreement.
 */
function Agreements(sequelize, DTypes) {
  // ISSUE: record IP address?
  const Agreement = sequelize.define('agreement', {
    // id
    firstName: { type: DTypes.STRING, allowNull: false },
    lastName: { type: DTypes.STRING, allowNull: false },
    email: { type: DTypes.STRING, allowNull: false },
    companyName: { type: DTypes.STRING },
    country: { type: DTypes.STRING, allowNull: false },
    minAge: { type: DTypes.ENUM, values: [18], allowNull: false },
    agreementRevised: { type: DTypes.DATEONLY, allowNull: false },
    // password: { type: DTypes.STRING, allowNull: false }, // ISSUE: password hashing
    // createdAt, updatedAt
  });

  function createSchema() /*: Promise<void> */ {
    return Agreement.sync(/* ISSUE: force? */);
  }

  const paths = {
    index: '/',
    signIn: '/signIn',
    register: '/register',
    agreement: '/Coop_Membership_Agreement',
  };

  function page(tpl) {
    return (req /*: express$Request */, res) => {
      // $FlowFixMe req.csrfToken
      res.send(Mustache.render(tpl, { csrf: req.csrfToken(), ...paths }));
    };
  }

  function register(req /*: express$Request */, res, next) {
    const body = { ...req.body };

    // Trim extra spaces; treat empty strings as missing data.
    Object.keys(body).forEach((k) => {
      body[k] = body[k].trim();
      if (body[k] === '') {
        body[k] = null;
      }
    });

    const {
      // $FlowFixMe
      firstName, lastName, companyName, country, email,
      // $FlowFixMe
      password, confirmPassword,
    } = body;

    if (password !== confirmPassword) {
      console.log('passwords do not match');
      res.sendStatus(400); // ISSUE: form verification UI
      return null;
    }

    // $FlowFixMe
    const minAge = body.verifiedYears ? 18 : null;
    const record = {
      firstName,
      lastName,
      email,
      companyName,
      country,
      minAge,
      // password,
      agreementRevised: membershipAgreement.revisionDate,
    };

    return Agreement.create(record)
      .then((it) => {
        res.send(`<p>Welcome, ${it.firstName}</p>`); // ISSUE: TODO: portal.
        console.log('Agreement:', it);
        // $FlowFixMe
        req.user = it;
      })
      .catch(oops => next(oops)); // ISSUE: form verification UI
  }

  function router(csrfProtection) {
    const it = Router();

    it.get(paths.index, csrfProtection, page(homePage));
    it.get(paths.register, csrfProtection, page(registerPage));
    it.get(paths.agreement, csrfProtection, markdown(membershipAgreement.text));

    // note csrfProtection has to go *after* urlencodedParser
    // ack dougwilson Feb 11, 2015
    // https://github.com/expressjs/csurf/issues/52#issuecomment-73981858
    it.post(paths.register, urlencodedParser, csrfProtection, register);
    // ISSUE: TODO: it.post(paths.signIn, urlencodedParser, signIn);
    return it;
  }

  return def({ createSchema, router });
}

function markdown(text) {
  // ISSUE: markdown to HTML
  return (req/*: express$Request */, res) => res.type('text/plain').send(text);
}


if (require.main === module) {
  // Access ambient powers (clock, random, files, network)
  // only when invoked as main module.
  /* eslint-disable global-require */
  /* global process */
  main(process.argv, {
    express: require('express'),
    Sequelize: require('sequelize'),
    uuid4: require('uuid4'),
    session: require('express-session'),
    csrf: require('csurf'),
  });
}
