/* global require, module */

// @flow

const bodyParser = require('body-parser');
const { docopt } = require('docopt');
const requireText = require('require-text');
const session = require('express-session'); // ISSUE: ambient clock access?
const Mustache = require('mustache');
const { Router } = require('express');
const cookieParser = require('cookie-parser');
const SequelizeStore = require('connect-session-sequelize')(session.Store);

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
 --verbose              log database statements
 -h --help              show usage

`;


function main(argv, { uuid4, express, Sequelize }) {
  const cli = docopt(usage, { argv: argv.slice(2) });
  const app = express();

  console.log('@@DEBUG: cli:', cli);
  const sequelize = new Sequelize(cli['--db'], {
    dialect: cli['--dialect'],
    logging: cli['--verbose'],
  });
  const site = Site(sequelize, Sequelize);
  const agreements = Agreements(sequelize, Sequelize, uuid4);

  if (cli.createdb) {
    site.createSchema(uuid4());
    agreements.createSchema();
  } else if (cli.start) {
    const port = parseInt(cli['--port'], 10);

    sequelize
      .authenticate()
      .then(() => {
        console.log('register: DB authenticated');

        site.getSecret().then((secret) => {
          app.use(cookieParser());
          app.use(session({
            secret,
            store: new SequelizeStore({ db: sequelize }),
            resave: false,
            saveUninitialized: false,
            proxy: true, // ISSUE: if you do SSL outside of node.
          }));

          app.use('/', agreements.router());
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

  // following connect-session-sequelize docs
  const Session = sequelize.define('session', {
    sid: {
      type: DTypes.STRING,
      primaryKey: true,
    },
    userId: DTypes.STRING,
    expires: DTypes.DATE,
    data: DTypes.STRING(50000),
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

  return def({ createSchema, getSecret });
}


/**
 * Executing the membership agreement.
 */
function Agreements(sequelize, DTypes, genToken) {
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
      // $FlowFixMe
      const rs = req.session;

      if (!rs.csrf) {
        // ISSUE: need HMAC for csrf?
        const csrf = genToken();
        console.log('@@session gen csrf:', { csrf });
        rs.csrf = csrf;
      }

      res.send(Mustache.render(tpl, { csrf: rs.csrf, ...paths }));
    };
  }

  // flow needs a little help with express middleware types
  function checkCSRF(req /*: express$Request */, res, next) {
    const body = req.body || {};
    // $FlowFixMe
    const check = { actual: body.csrf, expected: req.session.csrf };
    console.log('@@DEBUG checkCSRF:', check);

    if (check.actual !== check.expected) {
      console.log('bad CSRF token:', check);
      res.sendStatus(403);
    }
    next();
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
        req.user = it.id;
      })
      .catch(oops => next(oops)); // ISSUE: form verification UI
  }

  function router() {
    const it = Router();

    it.get(paths.index, page(homePage));
    it.get(paths.register, page(registerPage));
    it.get(paths.agreement, markdown(membershipAgreement.text));

    it.post(paths.register, urlencodedParser, checkCSRF, register);
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
  // Access ambient stuff only when invoked as main module.
  /* eslint-disable global-require */
  /* global process */
  main(process.argv, {
    express: require('express'),
    Sequelize: require('sequelize'),
    uuid4: require('uuid4'),
  });
}
