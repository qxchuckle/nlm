export const en = {
  // CLI description
  cliDescription: 'npm local modules - Local npm package development tool',
  optionDebug: 'Enable debug mode with verbose logging',
  optionLang: 'Set language (zh/en)',

  // push command
  cmdPushDesc:
    'Push current package to global store and update all projects using it',
  optionForce: 'Force execution, skip hash check',
  pushToStore: 'Pushing {pkg} to store...',
  pushedToStore: 'Pushed {pkg} to store',
  pushFailed: 'Push failed: {error}',
  pushNoChange: 'Package unchanged, skipping project updates',
  pushNoUsage: 'No projects are using this package',
  pushUpdateProject: 'Updating project ({current}/{total}): {path}',
  pushProjectNotInstalled:
    '{path} does not have this package installed, skipping',
  pushVersionNotExist:
    '{path} depends on version {version} which does not exist, skipping',
  pushUpdatedProject: 'Updated {path}',
  pushProjectUpToDate: '{path} is up to date, skipping',
  pushUpdateFailed: 'Failed to update {path}: {error}',
  pushComplete: 'Push complete, updated {count} projects',

  // install command
  cmdInstallDesc: 'Install nlm package to current project',
  installNoPackage:
    'No package specified, updating all installed nlm packages...',
  installRunPushFirst: 'Please run {cmd} in {name} project first',
  installNotInStore: '{pkg} does not exist in store',
  installAvailableVersions: 'Available versions: {versions}',
  installNoMatchVersion: 'No version satisfies {version}',
  installNoVersion: '{pkg} has no available versions',
  installTargetVersion: 'Target version {target}, installing version: {actual}',
  installPackage: 'Installing {pkg}',
  installProcessDeps: 'Processing dependency conflicts...',
  installContinue: 'Continuing installation...',
  installReplaceNested: 'Replacing nested packages...',
  installComplete: 'Installation complete {pkg}',
  allPackagesInstalled: 'All packages installed: {pkg}',

  // uninstall command
  cmdUninstallDesc: 'Uninstall nlm package',
  optionUninstallInstall:
    'Automatically install the package from npm after uninstalling',
  uninstallNoPackages: 'No packages to uninstall',
  uninstallNotInstalled: '{pkg} was not installed via nlm',
  uninstallPackage: 'Uninstalling {pkg}...',
  uninstallComplete: 'Uninstallation complete {pkg}',
  uninstallInstalling: 'Installing {pkg} from npm...',
  uninstallInstallComplete: 'Installed {pkg}',
  uninstallNote:
    'Note: Please manually reinstall actual dependencies (run npm install / yarn / pnpm install)',

  // update command
  cmdUpdateDesc: 'Update installed nlm packages',
  updateNotInstalled: '{pkg} is not installed, please install with {cmd} first',
  updateNoPackages: 'No nlm packages installed',
  updatePackage: 'Updating package ({current}/{total}): {pkg}...',
  updateUpdated: 'Updated {pkg}',
  updateUpToDate: '{pkg} is up to date, skipping',
  updateFailed: 'Failed to update {pkg}: {error}',
  updateComplete: 'Update complete: {updated} updated, {skipped} skipped',
  updateNotInStore: '{pkg} does not exist in store, skipping',
  updateNotInLockfile: '{pkg} not in lockfile, skipping',
  updateNoMatchVersion: '{pkg} has no version satisfying {version}, skipping',
  updateSingle: 'Updating {pkg}',

  // list command
  cmdListDesc: 'List installed nlm packages',
  optionStore: 'List all packages in global store',
  listNoPackages: 'No nlm packages installed in current project',
  listInstalled: 'Installed nlm packages:',
  listTotal: 'Total {count} packages',
  listStoreEmpty: 'No packages in global store',
  listStoreTitle: 'Packages in global store:',
  listSourcePath: 'Source path:',
  listUsedBy: 'Used by:',
  listUsedByCount: '{count} projects',

  // config command
  cmdConfigDesc: 'Configure nlm interactively',
  optionGlobal: 'Configure global settings (default is project-level)',
  configGlobalMode: 'Configuring global settings',
  configProjectMode: 'Configuring project settings',
  configSelectPackageManager: 'Select package manager',
  configCurrent: '(current)',
  configCustom: 'Custom...',
  configInputCustom: 'Enter custom value',
  configInputRequired: 'Package manager cannot be empty',
  configSaved: '{type} configuration saved',
  configGlobal: 'Global',
  configProject: 'Project',
  configResult: 'Configuration result:',
  configPackageManager: 'Package manager:',

  // Common errors
  errInvalidProject:
    'Current directory is not a valid project (missing package.json or node_modules)',
  errInvalidProjectSimple: 'Current directory is not a valid project',
  errInvalidPackage:
    'Current directory is not a valid npm package (missing or invalid package.json)',
  errInvalidPackageName: 'Invalid package name: {name}',
  errUnknownCommand: 'Unknown command: {cmd}',
  errUnknown: 'Unknown error: {error}',
  helpRunCommand: 'Run {cmd} to see available commands',

  // runtime
  runtimeInitialized: 'Runtime configuration initialized: {config}',

  // gitignore
  gitignoreNotExist:
    '.gitignore file does not exist, please manually add {entry} to .gitignore',
  gitignoreAdded: 'Automatically added {entry} to .gitignore',
  gitignoreAddFailed:
    'Failed to add {entry} to .gitignore, please add manually',

  installed: 'Installed {count} packages',
  updated: 'Updated {count} packages',
};
