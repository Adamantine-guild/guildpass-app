const fs = require('fs');
const path = require('path');

function findPackageJsonFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === 'node_modules' || file === 'dist' || file === '.git' || file === '.next') continue;
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findPackageJsonFiles(filePath, fileList);
    } else if (file === 'package.json') {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const packageFiles = findPackageJsonFiles(process.cwd());
const report = [];

packageFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf-8');
  const pkg = JSON.parse(content);
  
  const scripts = pkg.scripts || {};
  for (const [name, cmd] of Object.entries(scripts)) {
    if (['build', 'typecheck', 'lint'].includes(name)) {
      if (cmd.match(/(tsc|next build|docusaurus build).*(pnpm|npm|yarn|eslint)/) && !cmd.includes('-w @guildpass/env')) {
        report.push({ file: path.relative(process.cwd(), file), script: name, content: cmd });
      }
      // Specific check for the known bad pattern
      if (cmd.includes('tsc -p tsconfig.json pnpm start pnpm typecheck pnpm lint')) {
          report.push({ file: path.relative(process.cwd(), file), script: name, content: cmd });
      }
    }
  }
});

console.log('--- Malformed Scripts Report ---');
if (report.length === 0) {
  console.log('No malformed scripts found! All build, typecheck, and lint scripts are clean and single-purpose.');
} else {
  report.forEach(r => {
    console.log(`${r.file} -> [${r.script}]: "${r.content}"`);
  });
}
