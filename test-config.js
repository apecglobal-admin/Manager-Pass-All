fetch('http://127.0.0.1:3000/runtime-config.js')
  .then(res => res.text())
  .then(text => console.log(text.substring(0, 100)))
  .catch(err => console.error(err));
