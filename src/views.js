const requireText = require('require-text');
const Mustache = require('mustache');

// We treat requireText as a "link time" operation, not a powerful capability.
const pages = {
  index: { path: '/', text: requireText('./tpl/index.html', require) },
  signIn: { path: '/signIn' },
  register: { path: '/register', text: requireText('./tpl/register.html', require) },
  agreement: {
    path: '/Coop_Membership_Agreement',
    text: requireText('./tpl/Coop_Membership_Agreement.md', require),
    revisionDate: new Date('2017-11-17'),
    revisionHash: '8c033fb',
    contentLength: 19054,
  },
};
exports.pages = pages;

exports.render = Mustache.render;
