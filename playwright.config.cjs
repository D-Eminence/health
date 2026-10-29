module.exports = {
  testDir: './tests', timeout: 60000, workers: 1,
  use: {baseURL:'http://127.0.0.1:4173', channel:'chrome', viewport:{width:1440,height:1000}},
  reporter: 'list'
};
