/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', comment: 'import/no-cycle', from: {}, to: { circular: true } },
    { name: 'no-orphans', severity: 'warn', comment: 'import/no-unused-modules (orphan files)',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)cli\\.ts$'] }, to: {} },
    { name: 'not-to-unresolvable', severity: 'error', comment: 'import/no-unresolved', from: {}, to: { couldNotResolve: true } },
    { name: 'not-to-dev-dep', severity: 'error', comment: 'import/no-extraneous-dependencies (prod src → devDeps)',
      from: { path: '^src/', pathNot: '\\.test\\.ts$|\\.fixtures\\.ts$|\\.integration\\.' },
      to: { dependencyTypes: ['npm-dev'], pathNot: 'node_modules/@types/' } },
    { name: 'not-to-undeclared', severity: 'error', comment: 'import/no-extraneous-dependencies (undeclared)',
      from: {}, to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] } },
  ],
  options: { doNotFollow: { path: ['node_modules'] }, tsPreCompilationDeps: true, tsConfig: { fileName: 'tsconfig.json' } },
};
