# Auto Update

The desktop app uses `electron-updater` with GitHub Releases.

## Release Repository

- GitHub repo: `apecglobal-admin/Manager-Pass-All`
- Repo visibility: public
- Publish provider: GitHub Releases
- Windows updater target: NSIS installer

The portable `.exe` can still be built for manual distribution, but automatic updates are intended for users who install the NSIS setup package.

## Create a New Update

1. Update `version` in `package.json`, for example `0.1.1`.
2. Commit and push the change.
3. Create and push a tag that matches the version:

```powershell
git tag v0.1.1
git push origin v0.1.1
```

4. GitHub Actions runs `.github/workflows/release.yml`.
5. The workflow runs tests, builds the Windows NSIS installer, and publishes the release assets plus update metadata.

The workflow uses `secrets.GITHUB_TOKEN`, which GitHub provides automatically for public releases in this repository.

## Runtime Behavior

When the packaged desktop app starts, it checks GitHub Releases for an update. If a newer version is available, it downloads the update and prompts the user to restart the app to install it.

Set `APECGLOBAL_DISABLE_AUTO_UPDATE=1` to disable update checks for a packaged build.
