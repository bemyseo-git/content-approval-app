// ============================================================================
//  Brand configuration — edit this file to make the tool yours.
//  Drop in your logo, support email, and real brand colors.
// ============================================================================
export const BRAND = {
  name: 'BeMySEO',
  product: 'Review',
  tagline: 'Content review & approval',

  // Logo variants (vendored in /public). logoUrl is the white wordmark used on
  // the dark app/review headers; logoDarkUrl is the colored wordmark used on
  // light surfaces (login card, thank-you page). Leave both empty to fall back
  // to the "BeMySEO" text wordmark.
  logoUrl: '/logo-white.svg',
  logoDarkUrl: '/logo-dark.svg',

  supportEmail: 'connect@bemyseo.com',
  poweredByLine: 'Powered by BeMySEO',

  // BeMySEO brand palette (sampled from bemyseo.com). See DESIGN.md.
  colors: {
    brand:   '#1362FC',   // vivid BeMySEO blue — primary buttons, links, actions
    brandDk: '#0B4FD6',   // darker blue (hovers / active)
    accent:  '#1362FC',   // progress bars, focus rings, markers
    nav:     '#141B2E',   // deep navy — top bars / app chrome
    navDk:   '#0E1422',   // darker navy (chrome gradients)
    ink:     '#161A22',   // body text
    slate:   '#5C6470',   // muted text
    line:    '#E1E7F0',   // borders (cool)
    paper:   '#F6F8FC',   // app background (cool off-white)
    ok:      '#0C9648',   // approved (BeMySEO green)
    warn:    '#B5701A'    // changes requested (amber)
  }
}
