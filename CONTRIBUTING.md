# Contributing: Development and Design Notes

As is traditional, contributions should keep `npm test` passing.

This includes a lint check and static type checking; unit testing is
TODO.


## Static typechecking with flow

Use `npm run flow-status`.

Some library definitions are available using [flow-typed][ft]:

```
npm install --save express
flow-typed install express
```

[ft]: https://github.com/flow-typed/flow-typed/


## Coding Style: airbnb (mostly)

Use `npm run lint`. See `.eslintrc.yaml` for deviations from [Airbnb
style][AJSG].

[AJSG]: https://github.com/airbnb/javascript#readme


## Object capability (ocap) discipline

In order to supporting robust composition and cooperation without
vulnerability, code in this project should adhere to [object
capability discipline][ocap].

  - **Memory safety and encapsulation**
    - There is no way to get a reference to an object except by
      creating one or being given one at creation or via a message; no
      casting integers to pointers, for example. _JavaScript is safe
      in this way._

      From outside an object, there is no way to access the internal
      state of the object without the object's consent (where consent
      is expressed by responding to messages). _We use `Object.freeze`
      and closures rather than properties on `this` to achieve this._

  - **Primitive effects only via references**
    - The only way an object can affect the world outside itself is
      via references to other objects. All primitives for interacting
      with the external world are embodied by primitive objects and
      **anything globally accessible is immutable data**. There must be
      no `open(filename)` function in the global namespace, nor may
      such a function be imported. _It takes some discipline to use
      modules in node.js in this way.  We use a convention
      of only accessing ambient authority inside `if (require.main ==
      module) { ... }`._

[ocap]: http://erights.org/elib/capability/ode/ode-capabilities.html


## Web framework: express

bog standard stuff: body-parser, cookie-parser, csurf, express-session.

### Auto restart: nodemon

[nodemon](https://www.npmjs.com/package/nodemon) seems to work well:

```
npm install -g nodemon

nodemon --ext js,html src/main.js start
```

It's a nice tool, but it's not critical in the way that
eslint and flow are, so it's not in our `devDependencies`.


## Persistence: sequelize

[Sequelize][s] is "a promise-based ORM for Node.js v4 and up."

[s]: http://docs.sequelizejs.com/
