// ============================================================================
//  Client-facing translations for the review interface + thank-you page.
//  The language is chosen when the agency copies the client link: a plain
//  English link (/r/<token>) or a Spanish one (/r/<token>?lang=es).
//  Agency-only screens (Admin) stay in English.
// ============================================================================

export const LANGS = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'es', label: 'Español', short: 'ES' },
]

export const normalizeLang = (l) => (l === 'es' ? 'es' : 'en')

const STRINGS = {
  en: {
    // status labels
    status_approved: 'Approved',
    status_changes: 'Changes requested',
    status_pending: 'Pending',

    // load / error states
    invalid: 'This review link isn’t valid or has been removed.',
    loadError: 'Couldn’t load this review.',
    loading: 'Loading review…',

    // welcome back + name modal
    welcomeBack: (name) => `👋 Welcome back${name ? `, ${name}` : ''} — picking up right where you left off.`,
    dismiss: 'Dismiss',
    welcome: (client) => `Welcome${client ? `, ${client}` : ''}`,
    namePrompt: 'Add your name so your comments are clear to the team.',
    namePlaceholder: 'Your name',
    startReviewing: 'Start reviewing',

    // header
    progress: (approved, total) => `${approved} of ${total} approved`,
    completeReview: 'Complete review',
    noPage: 'No page is attached to this review yet.',

    // sidebar / sections
    sections: 'Sections',
    sectionsHint: 'Click a section here — or right on the page — to approve it or leave a comment.',
    comments: (n) => `${n} comment${n > 1 ? 's' : ''}`,
    allSections: '‹ All sections',
    approve: 'Approve',
    requestChanges: 'Request changes',
    changesShort: 'Changes',
    noCommentsYet: 'No comments yet.',
    noCommentsFirst: 'No comments yet — add the first one below.',
    reviewer: 'Reviewer',
    client: 'Client',
    reopen: 'Reopen',
    markResolved: 'Mark resolved',
    addComment: 'Add a comment for this section…',
    addCommentFor: (name) => `Add a comment for “${name}”…`,
    postComment: 'Post comment',
    done: 'Done',
    commentsLabel: 'Comments',
    prevSection: 'Previous section',
    nextSection: 'Next section',

    // complete confirmation
    confirmIncomplete: (left, total) =>
      `${left} of ${total} section${left > 1 ? 's are' : ' is'} not approved yet. Complete the review anyway?`,
    confirmComplete: 'Mark this review as complete?',

    // thank-you page
    tyTitle: (name) => `Thank you${name ? `, ${name}` : ''}!`,
    tyLead: (title) => (<>Your review of <b>{title}</b> is in — we have everything we need to move forward.</>),
    tyBody:
      'Our team is already rolling up our sleeves. We’ll action your approvals, work through every change you’ve ' +
      'requested, and refine the page accordingly — then send the updated version your way for a final look.',
    tyApproved: 'Approved',
    tyChanges: 'Changes requested',
    tyComments: (n) => `Comment${n === 1 ? '' : 's'}`,
    tyNextH: 'What happens next',
    tyStep1: 'We go through your feedback in detail.',
    tyStep2: 'We implement your changes and polish the page.',
    tyStep3: 'You’ll get the revised version to review again.',
    tyContact: (email) => (<>Questions in the meantime? Email us at <a href={`mailto:${email}`}>{email}</a>.</>),
    tyReopen: 'Need to add something? Reopen the review',
  },

  es: {
    status_approved: 'Aprobado',
    status_changes: 'Cambios solicitados',
    status_pending: 'Pendiente',

    invalid: 'Este enlace de revisión no es válido o ha sido eliminado.',
    loadError: 'No se pudo cargar esta revisión.',
    loading: 'Cargando revisión…',

    welcomeBack: (name) => `👋 ¡Hola de nuevo${name ? `, ${name}` : ''}! — continúas justo donde lo dejaste.`,
    dismiss: 'Cerrar',
    welcome: (client) => `Bienvenido${client ? `, ${client}` : ''}`,
    namePrompt: 'Agrega tu nombre para que tus comentarios queden claros para el equipo.',
    namePlaceholder: 'Tu nombre',
    startReviewing: 'Comenzar la revisión',

    progress: (approved, total) => `${approved} de ${total} aprobadas`,
    completeReview: 'Finalizar revisión',
    noPage: 'Todavía no hay ninguna página adjunta a esta revisión.',

    sections: 'Secciones',
    sectionsHint: 'Haz clic en una sección aquí — o directamente en la página — para aprobarla o dejar un comentario.',
    comments: (n) => `${n} comentario${n > 1 ? 's' : ''}`,
    allSections: '‹ Todas las secciones',
    approve: 'Aprobar',
    requestChanges: 'Solicitar cambios',
    changesShort: 'Cambios',
    noCommentsYet: 'Aún no hay comentarios.',
    noCommentsFirst: 'Aún no hay comentarios — agrega el primero abajo.',
    reviewer: 'Revisor',
    client: 'Cliente',
    reopen: 'Reabrir',
    markResolved: 'Marcar como resuelto',
    addComment: 'Agrega un comentario para esta sección…',
    addCommentFor: (name) => `Agrega un comentario para “${name}”…`,
    postComment: 'Publicar comentario',
    done: 'Listo',
    commentsLabel: 'Comentarios',
    prevSection: 'Sección anterior',
    nextSection: 'Sección siguiente',

    confirmIncomplete: (left, total) =>
      `${left} de ${total} ${left > 1 ? 'secciones aún no están aprobadas' : 'sección aún no está aprobada'}. ¿Finalizar la revisión de todos modos?`,
    confirmComplete: '¿Marcar esta revisión como finalizada?',

    tyTitle: (name) => `¡Gracias${name ? `, ${name}` : ''}!`,
    tyLead: (title) => (<>Tu revisión de <b>{title}</b> está lista — tenemos todo lo que necesitamos para avanzar.</>),
    tyBody:
      'Nuestro equipo ya se puso manos a la obra. Aplicaremos tus aprobaciones, trabajaremos en cada cambio que ' +
      'solicitaste y ajustaremos la página en consecuencia — luego te enviaremos la versión actualizada para una última revisión.',
    tyApproved: 'Aprobadas',
    tyChanges: 'Cambios solicitados',
    tyComments: (n) => `Comentario${n === 1 ? '' : 's'}`,
    tyNextH: 'Qué sigue ahora',
    tyStep1: 'Revisamos tus comentarios en detalle.',
    tyStep2: 'Implementamos tus cambios y pulimos la página.',
    tyStep3: 'Recibirás la versión revisada para volver a revisarla.',
    tyContact: (email) => (<>¿Tienes preguntas mientras tanto? Escríbenos a <a href={`mailto:${email}`}>{email}</a>.</>),
    tyReopen: '¿Necesitas agregar algo? Reabre la revisión',
  },
}

// Returns a translator bound to the given language code. Each key is either a
// string or a function (for interpolation / JSX), called through directly.
export function makeT(lang) {
  const dict = STRINGS[normalizeLang(lang)] || STRINGS.en
  return (key, ...args) => {
    const v = dict[key]
    return typeof v === 'function' ? v(...args) : v
  }
}

export const statusLabel = (t, s) =>
  s === 'approved' ? t('status_approved') : s === 'changes' ? t('status_changes') : t('status_pending')
