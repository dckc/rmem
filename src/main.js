/* global require, module */

// @flow

const bodyParser = require('body-parser');
const { docopt } = require('docopt');
const requireText = require('require-text');

const homePage = requireText('./tpl/index.html', require);
const registerPage = requireText('./tpl/register.html', require);


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


function main(argv, { express, Sequelize }) {
  const cli = docopt(usage, { argv: argv.slice(2) });
  const app = express();

  console.log('@@DEBUG: cli:', cli);
  const sequelize = new Sequelize(cli['--db'], { dialect: cli['--dialect'] });
  const rmem = Membership(sequelize, Sequelize);

  if (cli.createdb) {
    rmem.createSchema();
  } else if (cli.start) {
    const port = parseInt(cli['--port'], 10);

    rmem.route(app);

    app.listen(port, () => console.log(`Example app listening on port ${port}!`));
  }
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
  /* global process */
  main(process.argv, {
    express: require('express'),
    Sequelize: require('sequelize'),
  });
}
