import { DotLottie } from "/assets/vendor/dotlottie-web/dist/index.js";

DotLottie.setWasmUrl("/assets/vendor/dotlottie-web/dist/dotlottie-player.wasm");

const loadingCanvas = document.querySelector("#loading-player");
const loadingModal = document.querySelector("#loading-modal");

window.loadingLottieController = {
  pause() {},
  play() {},
  resize() {},
};

if (loadingCanvas instanceof HTMLCanvasElement) {
  const loadingLottie = new DotLottie({
    canvas: loadingCanvas,
    src: "/assets/lottie/loading.lottie",
    autoplay: false,
    loop: true,
    layout: {
      fit: "contain",
      align: [0.5, 0.5],
    },
    renderConfig: {
      autoResize: true,
      freezeOnOffscreen: false,
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    },
  });

  let isReady = false;
  let shouldPlay = !loadingModal?.hidden;

  const syncPlayback = () => {
    if (!isReady) {
      return;
    }

    loadingLottie.resize();

    if (shouldPlay) {
      loadingLottie.play();
      return;
    }

    loadingLottie.pause();
  };

  const resizePlayer = () => {
    if (!isReady) {
      return;
    }

    loadingLottie.resize();
  };

  loadingLottie.addEventListener("ready", () => {
    isReady = true;
    syncPlayback();
  });

  loadingLottie.addEventListener("load", () => {
    syncPlayback();
  });

  loadingLottie.addEventListener("loadError", (event) => {
    console.error("[loading-lottie] Failed to load the loading animation.", event.error);
  });

  window.addEventListener("resize", resizePlayer);

  window.loadingLottieController = {
    pause() {
      shouldPlay = false;

      if (isReady) {
        loadingLottie.pause();
      }
    },
    play() {
      shouldPlay = true;
      syncPlayback();
    },
    resize() {
      resizePlayer();
    },
  };
}
