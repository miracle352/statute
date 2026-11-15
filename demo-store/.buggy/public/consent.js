// Cookie banner: records the visitor's choice in a first-party cookie.
(function () {
  var choice = (document.cookie.match(/(?:^|; )consent=([^;]+)/) || [])[1];
  var banner = document.getElementById("consent");
  if (!choice) banner.hidden = false;

  function save(value) {
    document.cookie = "consent=" + value + "; path=/; max-age=31536000; SameSite=Lax";
    banner.hidden = true;
  }
  document.getElementById("accept-all").onclick = function () { save("accepted"); };
  document.getElementById("reject-all").onclick = function () { save("rejected"); };
})();
