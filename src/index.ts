require("../.pnp.js").setup();
const { run } = require("probot");
const { app } = require("./app");

run(app);

export {};
