import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.join(__dirname, '..');
const appsDir = path.join(root, 'apps');
const packagesDir = path.join(root, 'packages');

let hasError = false;

function error(msg) {
  console.error(`[ERROR] ${msg}`);
  hasError = true;
}

function getDirectories(source) {
  if (!fs.existsSync(source)) return [];
  return fs.readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(source, dirent.name));
}

const allDirs = [...getDirectories(appsDir), ...getDirectories(packagesDir)];
const packages = {};

console.log('Validating workspace packages...');

// 1. Validate package.json
for (const dir of allDirs) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    error(`Missing package.json in ${dir}`);
    continue;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  
  if (!pkg.name) error(`Missing 'name' field in ${pkgPath}`);
  if (!pkg.version) error(`Missing 'version' field in ${pkgPath}`);

  packages[pkg.name] = {
    dir,
    pkg,
    deps: { ...pkg.dependencies, ...pkg.devDependencies }
  };

  // 2. Validate tsconfig.json extends base
  const tsConfigPath = path.join(dir, 'tsconfig.json');
  if (fs.existsSync(tsConfigPath)) {
    const tsconfig = JSON.parse(fs.readFileSync(tsConfigPath, 'utf8'));
    const expectedExtends = "../../tsconfig.base.json";
    
    if (!tsconfig.extends) {
      error(`Missing 'extends' in ${tsConfigPath}`);
    } else if (tsconfig.extends !== expectedExtends) {
      error(`Invalid 'extends' in ${tsConfigPath}. Expected '${expectedExtends}', got '${tsconfig.extends}'`);
    }
  }
}

// 3. Check circular dependencies
function checkCircular(startPkg, currentPkg = startPkg, visited = new Set(), pathList = []) {
  if (visited.has(currentPkg)) {
    if (currentPkg === startPkg) {
      error(`Circular dependency detected: ${pathList.join(' -> ')} -> ${currentPkg}`);
    }
    return;
  }
  
  visited.add(currentPkg);
  pathList.push(currentPkg);

  const pkgData = packages[currentPkg];
  if (pkgData) {
    for (const dep of Object.keys(pkgData.deps)) {
      if (packages[dep]) {
        checkCircular(startPkg, dep, new Set(visited), [...pathList]);
      }
    }
  }
}

for (const pkgName of Object.keys(packages)) {
  checkCircular(pkgName);
}

if (hasError) {
  console.error('\nWorkspace validation failed.');
  process.exit(1);
} else {
  console.log('\nWorkspace validation passed! \u2728');
  process.exit(0);
}
