// electron-builder beforePack: refuse to package a stale out/. The renderer
// shows __APP_VERSION__ baked in at build time; packaging after a version
// bump without rebuilding shipped v2.33.5 whose UI said v2.33.4 (and
// carried the old renderer code).
const { readFileSync, readdirSync } = require('fs')
const { join } = require('path')

module.exports = async function checkBuildVersion() {
  const root = join(__dirname, '..')
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const dir = join(root, 'out', 'renderer', 'assets')
  const stamped = readdirSync(dir).filter(f => f.endsWith('.js'))
    .some(f => readFileSync(join(dir, f), 'utf8').includes(JSON.stringify(version)))
  if (!stamped) throw new Error(`out/ was built for another version than ${version}: run "npx electron-vite build" first`)
}
