![CI](https://github.com/holepunchto/updater-service/actions/workflows/ci.yml/badge.svg)
![Release](https://github.com/holepunchto/updater-service/actions/workflows/release.yml/badge.svg)
![Bump Deps](https://github.com/holepunchto/updater-service/actions/workflows/bump-deps.yml/badge.svg)

# Updater Service
- Run pear app in a worker (using pear-run)
- Auto restart worker on pear update (using pear-updates)

## Example
- Local mode
```shell
pear run --dev sample-updater
```
Make some change to `sample-runner.js`, the app will auto restart

- Prod mode
```shell
pear stage some-channel
pear run pear://<app-link>/sample-updater
```
Make some change to `sample-runner.js`, then `pear stage some-channel`, the app will auto restart
