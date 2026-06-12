fetch('http://127.0.0.1:3000/vendor/supabase.js')
  .then(res => {
    console.log('Status:', res.status);
    return res.text();
  })
  .then(text => console.log(text.substring(0, 100)))
  .catch(err => console.error(err));
