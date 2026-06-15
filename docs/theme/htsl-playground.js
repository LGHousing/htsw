(function () {
  function setupPlaygrounds(root) {
    var preBlocks = root.querySelectorAll
      ? root.querySelectorAll("pre")
      : document.querySelectorAll("pre");

    preBlocks.forEach(function (pre) {
      var code = pre.querySelector("code.language-htsl");
      if (!code) return;

      pre.classList.add("playground");

      var buttons = pre.querySelector(".buttons");
      if (!buttons) {
        buttons = document.createElement("div");
        buttons.className = "buttons";
        pre.insertBefore(buttons, pre.firstChild);
      }

      // Don't add a second play button
      if (buttons.querySelector(".play-button")) return;

      var runBtn = document.createElement("button");
      runBtn.className = "play-button";
      runBtn.title = "Run this code";
      var playIcon = document.getElementById("fa-play");
      if (playIcon) {
        runBtn.innerHTML = playIcon.innerHTML;
      }
      buttons.appendChild(runBtn);

      runBtn.addEventListener("click", function () {
        var result = pre.querySelector("code.result");
        if (!result) {
          result = document.createElement("code");
          result.className = "result hljs language-text";
          pre.appendChild(result);
        }

        result.innerText = "Running...";
        result.classList.remove("result-no-output");

        var codeText = code.textContent;

        try {
          var out = htswPlayground.runHtsl(codeText);
          if (out.diagnostics.length > 0) {
            result.innerText = out.diagnostics.join("\n");
            result.classList.add("result-no-output");
          } else {
            result.innerText = out.output.join("\n");
            if (out.output.length === 1 && out.output[0] === "(no output)") {
              result.classList.add("result-no-output");
            }
          }
        } catch (e) {
          result.innerText = "Error: " + e.message;
          result.classList.add("result-no-output");
        }
      });
    });
  }

  // Initial setup
  setupPlaygrounds(document);

  // Re-run on SPA navigation
  var content = document.getElementById("mdbook-content");
  if (content) {
    new MutationObserver(function () {
      setupPlaygrounds(document);
    }).observe(content, { childList: true, subtree: true });
  }
})();
