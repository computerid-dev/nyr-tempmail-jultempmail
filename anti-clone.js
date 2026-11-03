(function () {
  "use strict";
  var PIN_HOST = "nyr-tempmail-jultempmail.vercel.app";
  // localhost hanya sementara, dihapus saat SIAP DEPLOY
  var ALLOWED = [PIN_HOST, "localhost", "127.0.0.1"];
  var APP_PATH = "/tempmail/";
  var verified = ALLOWED.indexOf(location.hostname) !== -1;
  var self = document.currentScript;

  if (self && self.getAttribute("data-mode") === "guard") {
    if (!verified) location.replace("/");
    return;
  }
  if (verified) {
    location.replace(APP_PATH);
    return;
  }
  var box = document.getElementById("pesan");
  if (box) box.textContent = "link tidak resmi! Tidak dapat dibuka!";
})();
