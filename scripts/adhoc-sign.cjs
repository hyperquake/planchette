'use strict'

const { execFileSync } = require('node:child_process')
const path = require('node:path')

/**
 * electron-builder afterPack hook: ad-hoc sign the macOS app.
 *
 * Repackaging invalidates the signature Electron ships with, and macOS will not
 * launch an arm64 binary with a broken signature at all. It reports the app as
 * "damaged", which reads as a corrupt download rather than a signing problem and
 * sends people chasing the wrong thing.
 *
 * An ad-hoc signature (`--sign -`) is not a Developer ID and does nothing for
 * Gatekeeper, which still quarantines anything downloaded. It only makes the
 * binary loadable. See docs/DISTRIBUTION.md for what coworkers have to do on
 * first launch.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)

  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
    console.log(`  • ad-hoc signed ${appName}`)
  } catch (err) {
    console.error(`  ✗ ad-hoc signing failed for ${appName}. It will not launch on Apple Silicon.`)
    throw err
  }
}
