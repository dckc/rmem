/* global require, module */

// @flow

const bodyParser = require('body-parser');
const requireText = require('require-text');

const homePage = requireText('./tpl/index.html', require);
const registerPage = requireText('./tpl/register.html', require);

const memDBConfig = {
  dialect: 'sqlite',
  storage: ':memory:',
};


function main({ express, Sequelize }) {
  const app = express();
  const port = 3000; // ISSUE: parameterize port

  const sequelize = new Sequelize(memDBConfig);
  const rmem = Membership(sequelize, Sequelize);
  rmem.createSchema() // ISSUE: only 1st time.
    .then(() => {
      rmem.route(app);

      app.listen(port, () => console.log(`Example app listening on port ${port}!`));
    });
}


function Membership(sequelize, DTypes) {
  const Member = sequelize.define('member', { name: { type: DTypes.STRING } });

  function createSchema() /*: Promise<void> */ {
    return Member.sync(/* ISSUE: force? */);
  }

  function register(req, res) {
    sequelize
      .authenticate()
      .then(() => {
        console.log('register: DB authenticated');
        const { name } = req.body;
        Member.create({ name })
          .then(() => {
            res.send(`<p>Welcome, ${name}</p>`); // ISSUE: templates?
          });
      });
  }

  function route(app) {
    const page = txt => ((req, res) => res.send(txt));
    const urlencodedParser = bodyParser.urlencoded({ extended: false });

    app.get('/', page(homePage));
    // ISSUE: `/register` magic string
    // should (statically) extract from homePage
    app.get('/register', page(registerPage));
    // ISSUE: csrf
    app.post('/register', urlencodedParser, register);
  }

  return { createSchema, route, register };
}


if (require.main === module) {
  // Access ambient stuff only when invoked as main module.
  /* eslint-disable global-require */
  main({
    express: require('express'),
    Sequelize: require('sequelize'),
  });
}
