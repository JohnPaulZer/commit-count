const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceDirectory = path.join(
  projectRoot,
  "node_modules",
  "@lottiefiles",
  "dotlottie-web",
  "dist",
);
const targetDirectory = path.join(
  projectRoot,
  "public",
  "assets",
  "vendor",
  "dotlottie-web",
  "dist",
);
const filesToCopy = [
  "index.js",
  "dotlottie-player.wasm",
];

fs.mkdirSync(targetDirectory, { recursive: true });

for (const fileName of filesToCopy) {
  const sourcePath = path.join(sourceDirectory, fileName);
  const targetPath = path.join(targetDirectory, fileName);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing required Lottie runtime file: ${sourcePath}`);
  }

  fs.copyFileSync(sourcePath, targetPath);
}

console.log("Copied Lottie runtime into public/assets/vendor.");
