'use strict'

const fs = require('fs')
const path = require('path')
const util = require('util')
const chalk = require('chalk')

const fsPromises = {
  writeFile: util.promisify(fs.writeFile)
}
const { handleError } = require('../util')
const {
  COLORS,
  boxbox
} = require('../ncm-style')
const L = console.log

const SEVERITY_RMAP = [
  'NONE',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
]
const W = [
  40, // Module Name
  12, // Risk Score
  23, // License
  15 // Security
]

const SEVERITY_COLOR = {
  'CRITICAL': COLORS.red,
  'HIGH': COLORS.orange,
  'MEDIUM': COLORS.yellow,
  'LOW': COLORS.light1,
  'NONE': COLORS.base
}

module.exports = {
  jsonReport,
  outputReport,
  W,
  SEVERITY_RMAP,
  SEVERITY_COLOR,
  severityMeter,
  severityText,
  severityTextLabel,
  shortVulnerabilityList,
  moduleList,
  moduleSort
}

function jsonReport (report) {
  try {
    let json = JSON.stringify(report, null, 2)
    L(json)
  } catch (err) {
    handleError('Tools::UnableToParseReport')
  }
}

async function outputReport (report, dir) {
  if (typeof dir !== 'string') dir = process.cwd()

  try {
    let json = JSON.stringify(report)
    let timestamp = new Date().valueOf()
    let reportFile = path.join(dir, `ncm-score-report-${timestamp}.json`)
    await fsPromises.writeFile(reportFile, json, 'utf8')

    L(boxbox('✓', `Report successfully written to: ${reportFile}`, COLORS.green))
  } catch (err) {
    handleError('Tools::UnableToFormatOutput')
  }
}

function moduleList (report, dividers) {
  report = moduleSort(report)

  /* Module List */
  L(chalk`{${COLORS.light1}   Module Name${' '.repeat(W[0] - 9)}Risk${' '.repeat(W[1] - 3)}License${' '.repeat(W[2] - 6)}Security}`)
  L(chalk`{${COLORS.light1} ┌──${'─'.repeat(W[0])}┬${'─'.repeat(W[1])}┬${'─'.repeat(W[2])}┬${'─'.repeat(W[3])}┐}`)

  report.forEach((pkg, ind) => {
    /* Module Name */
    let mod = pkg.name + ' @ ' + pkg.version
    if (mod.length > W[0]) mod = `${pkg.name.slice(0, W[0] - 14)}... @ ${pkg.version}`

    let riskBadge = ''
    let license = ''
    let licenseBadge = ''
    let securityBadges = []

    if (pkg.published) {
      /* license badge */
      let chunked = pkg.license.title.split(':')
      license = chunked[chunked.length - 1].trim()

      // append license text to fit within column
      if (license.length + 3 > W[2]) license = license.slice(0, W[2] - 4) + '…'

      licenseBadge = pkg.license && pkg.license.pass
        ? chalk`{${COLORS.green} ✓}`
        : chalk`{${COLORS.red} X}`

      /* security badge */
      let vulns = [0, 0, 0, 0]
      for (const { group, severity } of pkg.failures) {
        if (group === 'security') {
          if (severity === 'CRITICAL') vulns[3]++
          if (severity === 'HIGH') vulns[2]++
          if (severity === 'MEDIUM') vulns[1]++
          if (severity === 'LOW') vulns[0]++
        }
      }
      securityBadges = [
        vulns.reduce((a, b) => a + b, 0) === 0
          ? chalk`{${COLORS.green} ✓} 0` : chalk`{${COLORS.red} X} `,
        vulns[3] > 0 ? chalk`{${COLORS.red} ${vulns[3]}C} ` : '',
        vulns[2] > 0 ? chalk`{${COLORS.orange} ${vulns[2]}H} ` : '',
        vulns[1] > 0 ? chalk`{${COLORS.yellow} ${vulns[1]}M} ` : '',
        vulns[0] > 0 ? chalk`{${COLORS.light1} ${vulns[0]}L} ` : ''
      ]

      /* risk badge */
      let riskMeter = severityMeter(SEVERITY_RMAP[pkg.maxSeverity].toUpperCase())[0] + severityMeter(SEVERITY_RMAP[pkg.maxSeverity].toUpperCase())[1]
      let riskLabel = severityTextLabel(SEVERITY_RMAP[pkg.maxSeverity].toUpperCase())
      riskBadge = riskMeter + riskLabel

      /* printing */
      L(
        // module label with left and right bar
        chalk`{${COLORS.light1} │} ${mod} ${' '.repeat(W[0] - mod.length)}{${COLORS.light1} │} ` +

        // risk badge with right bar
        riskBadge + chalk`${' '.repeat(W[1] - 10)}{${COLORS.light1} │} ` +

        // license badge with right bar
        licenseBadge + chalk` ${license}${' '.repeat(W[2] - license.length - 3)}{${COLORS.light1} │} ` +

        // security badge with right bar
        securityBadges.join('') + chalk`${' '.repeat(W[3] - 2 - securityBadges.filter(x => x !== '').length * 2)}{${COLORS.light1} │}`
      )
    } else {
      /* printing */
      L(
        // module label with left and right bar
        chalk`{${COLORS.light1} │} ${mod} ${' '.repeat(W[0] - mod.length)}{${COLORS.light1} │} ` +

        // spacing with right bar
        chalk`${' '.repeat(W[1] - 1)}{${COLORS.light1} │}` +

        // spacing with right bar
        chalk`${' '.repeat(W[2])}{${COLORS.light1} │}` +

        // spacing with right bar
        chalk`${' '.repeat(W[3])}{${COLORS.light1} │}`
      )
    }

    /* Cell Divider */
    if (ind === report.length - 1) {
      L(chalk`{${COLORS.light1} └──${'─'.repeat(W[0])}┴${'─'.repeat(W[1])}┴${'─'.repeat(W[2])}┴${'─'.repeat(W[3])}┘}`)
    } else if (dividers) {
      L(chalk`{${COLORS.light1} ├──${'─'.repeat(W[0])}┼${'─'.repeat(W[1])}┼${'─'.repeat(W[2])}┼${'─'.repeat(W[3])}┤}`)
    }
  })
}

function shortVulnerabilityList (report) {
  let netSecurity = {
    'LOW': 0,
    'MEDIUM': 0,
    'HIGH': 0,
    'CRITICAL': 0,
    'AFFECTED': new Set()
  }

  for (const pkg of report) {
    for (const failure of pkg.failures || []) {
      if (failure.group === 'security') {
        netSecurity[failure.severity]++
        netSecurity.AFFECTED.add(pkg.name)
      }
    }
  }

  const vulnerabilityCount = netSecurity.CRITICAL + netSecurity.HIGH + netSecurity.MEDIUM + netSecurity.LOW
  const securityBadge = vulnerabilityCount > 0 ? `${COLORS.red} !` : `${COLORS.green} ✓`
  if (netSecurity.AFFECTED.size > 0) {
    L(chalk`  {${securityBadge}} ${vulnerabilityCount} security vulnerabilities found across ${netSecurity.AFFECTED.size} modules`)
  } else {
    L(chalk`  {${securityBadge}} ${vulnerabilityCount} security vulnerabilities found`)
  }
  L(chalk`    {${COLORS.red} C} ${netSecurity.CRITICAL} critical severity`)
  L(chalk`    {${COLORS.orange} H} ${netSecurity.HIGH} high severity`)
  L(chalk`    {${COLORS.yellow} M} ${netSecurity.MEDIUM} medium severity`)
  L(chalk`    {${COLORS.light1} L} ${netSecurity.LOW} low severity`)
}

function moduleSort (report) {
  report.sort((a, b) => {
    if (a.maxSeverity > b.maxSeverity) return -1
    if (b.maxSeverity > a.maxSeverity) return 1
    if (a.maxSeverity === b.maxSeverity) {
      if (a.name < b.name) return -1
      if (b.name < a.name) return 1
    }
  })
  return report
}

function severityMeter (severity) {
  const risk = SEVERITY_RMAP.indexOf(severity)

  return [
    chalk`{${SEVERITY_COLOR[severity]} ${'|'.repeat(risk)}}`,
    chalk`{${COLORS.base} ${'|'.repeat(4 - risk)}}`
  ].join('')
}

function severityText (severity) {
  severity = severity[0].toUpperCase() + severity.slice(1).toLowerCase()
  return chalk`{${SEVERITY_COLOR[severity.toUpperCase()]} ${severity}}`
}

function severityTextLabel (severity) {
  severity = severity.toUpperCase()
  const severityLabel = {
    CRITICAL: 'Crit',
    HIGH: 'High',
    MEDIUM: 'Med ',
    LOW: 'Low ',
    NONE: 'None'
  }
  const color = severity === 'NONE' ? COLORS.base : COLORS.light1
  return chalk`{${color} ${severityLabel[severity]}}`
}