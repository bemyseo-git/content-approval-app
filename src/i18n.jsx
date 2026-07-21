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
    welcomeBack: (name, updates) =>
      `👋 Welcome back${name ? `, ${name}` : ''} — picking up right where you left off.${updates > 0 ? ` ${updates} update${updates > 1 ? 's' : ''} since your last visit.` : ''}`,
    dismiss: 'Dismiss',
    welcome: (client) => `Welcome${client ? `, ${client}` : ''} 👋`,
    welcomeMeta: (n, mins) => `${n} section${n === 1 ? '' : 's'} to review · takes about ${mins} minute${mins === 1 ? '' : 's'}`,
    namePrompt: 'Add your name so your comments are clear to the team.',
    namePlaceholder: 'Your name',
    startReviewing: 'Start reviewing',
    privacyNote: (agency) => `🔒 This private review link was created just for you by ${agency}.`,

    // first-visit coach marks
    coachTitle: 'How it works',
    coachStep1: 'Tap any section — right on the page, or in the list.',
    coachStep2: 'Approve it or request changes, and leave comments.',
    coachStep3: 'Done? Hit “Complete review” to send everything to us.',
    coachGotIt: 'Got it — start reviewing',

    // header
    progress: (approved, total) => `${approved} of ${total} approved`,
    completeReview: 'Complete review',
    noPage: 'No page is attached to this review yet.',
    dueBy: (d) => `Review by ${d}`,

    // preview frame — separates the reviewed page from the review tool
    previewLabel: 'Page preview — the content you’re reviewing',
    previewHint: 'Links & forms disabled',
    pvDesktop: 'Desktop',
    pvMobile: 'Phone',
    linkNote: 'That link is part of the page being reviewed — links are turned off here. Click a section to leave feedback instead.',

    // sidebar / sections
    sections: 'Sections',
    sectionsHint: 'Click a section here — or right on the page — to approve it or leave a comment. Your progress saves automatically, so you can leave and come back anytime.',
    comments: (n) => `${n} comment${n > 1 ? 's' : ''}`,
    allSections: '‹ All sections',
    approve: 'Approve',
    approveNext: 'Approve & next',
    approveFinish: 'Approve & finish',
    requestChanges: 'Request changes',
    changesShort: 'Changes',
    noCommentsYet: 'No comments yet.',
    noCommentsFirst: 'No comments yet — add the first one below.',
    reviewer: 'Reviewer',
    client: 'Client',
    reopen: 'Reopen',
    markResolved: 'Mark resolved',
    deleteComment: 'Delete comment',
    confirmDeleteComment: 'Delete this comment?',
    confirmDeleteCommentBody: 'It will be removed from the review for everyone.',
    deleteShort: 'Delete',
    cancel: 'Cancel',
    newBadge: 'New',

    // general (page-level) feedback — not tied to a single section
    generalTitle: 'General feedback',
    generalHint: 'Thoughts about the page overall — tone, missing info, anything that isn’t about one specific section.',
    generalShort: 'General',
    addGeneralComment: 'Add general feedback',
    contactLine: (email) => (<>Questions? Prefer to talk it through? Email us at <a href={`mailto:${email}`}>{email}</a>.</>),
    addComment: 'Add a comment for this section…',
    addCommentFor: (name) => `Add a comment for “${name}”…`,
    postComment: 'Post comment',
    done: 'Done',
    commentsLabel: 'Comments',
    prevSection: 'Previous section',
    nextSection: 'Next section',

    // finish-review choice — the client picks one of two outcomes
    finishTitle: 'Finish your review',
    finishSummary: (a, ch, cm) =>
      `${a} approved · ${ch} change request${ch === 1 ? '' : 's'} · ${cm} comment${cm === 1 ? '' : 's'}`,
    optApprove: 'Approve this content',
    optApproveSub: 'You’re happy with it — we’ll finalize the content, taking your comments into account.',
    optRevise: 'Request a new version',
    optReviseSub: (n) => n > 0
      ? `We’ll incorporate your ${n} requested change${n > 1 ? 's' : ''} and send you an updated version to review.`
      : 'We’ll revise the content based on your comments and send you an updated version to review.',
    keepReviewing: 'Keep reviewing',
    autosaveNote: 'Not ready to finish? Your progress saves automatically — you can close this page and come back anytime using the same link.',

    // thank-you page
    tyTitle: (name) => `Thank you${name ? `, ${name} team` : ''}!`,
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
    tySummaryH: 'Your feedback summary',
    tyContinue: 'Thought of something else? You can reopen the review and continue right where you left off.',
    tyReopen: 'Reopen the review',

    // thank-you variant when the client chose "approve" (no revision loop)
    tyApprLead: (title) => (<>You approved <b>{title}</b> — we have everything we need to finalize it.</>),
    tyApprBody:
      'Our team will give it a final polish, fold in your comments, and take the approved content straight to production.',
    tyApprStep1: 'We do a final pass over the approved content.',
    tyApprStep2: 'We use it to build your live page.',
    tyApprStep3: 'You get the link as soon as it’s published.',

    // finalized screen — the agency accepted the content; the link is locked
    finalTitle: (client) => `All set${client ? `, ${client} team` : ''} — this content is final!`,
    finalLead: (title) => (<>The review of <b>{title}</b> is closed — your approved content is now being turned into your live page.</>),
    finalBody:
      'No further action is needed on your side. Our team is building the page exactly as approved — ' +
      'if anything comes up in the meantime, just reach out and we’ll take care of it.',
    finalNextH: 'What happens next',
    finalStep1: 'We build your live page with the approved content.',
    finalStep2: 'Everything gets a final QA pass on desktop and mobile.',
    finalStep3: 'You get the link as soon as it’s published.',
  },

  es: {
    // status labels
    status_approved: 'Aprobado',
    status_changes: 'Cambios solicitados',
    status_pending: 'Pendiente',

    // load / error states
    invalid: 'Este enlace de revisión no es válido o ha sido eliminado.',
    loadError: 'No se pudo cargar esta revisión.',
    loading: 'Cargando revisión…',

    // welcome back + name modal
    welcomeBack: (name, updates) =>
      `👋 ¡Hola de nuevo${name ? `, ${name}` : ''}! — continúas justo donde lo dejaste.${updates > 0 ? ` ${updates} novedad${updates > 1 ? 'es' : ''} desde tu última visita.` : ''}`,
    dismiss: 'Cerrar',
    welcome: (client) => `Bienvenido${client ? `, ${client}` : ''} 👋`,
    welcomeMeta: (n, mins) => `${n} sección${n === 1 ? '' : 'es'} para revisar · toma unos ${mins} minuto${mins === 1 ? '' : 's'}`,
    namePrompt: 'Agrega tu nombre para que tus comentarios queden claros para el equipo.',
    namePlaceholder: 'Tu nombre',
    startReviewing: 'Comenzar la revisión',
    privacyNote: (agency) => `🔒 Este enlace de revisión privado fue creado solo para ti por ${agency}.`,

    // first-visit coach marks
    coachTitle: 'Cómo funciona',
    coachStep1: 'Toca cualquier sección — directamente en la página o en la lista.',
    coachStep2: 'Apruébala o solicita cambios, y deja tus comentarios.',
    coachStep3: '¿Listo? Pulsa “Finalizar revisión” para enviárnoslo todo.',
    coachGotIt: 'Entendido — comenzar la revisión',

    // header
    progress: (approved, total) => `${approved} de ${total} aprobadas`,
    completeReview: 'Finalizar revisión',
    noPage: 'Todavía no hay ninguna página adjunta a esta revisión.',
    dueBy: (d) => `Revisar antes del ${d}`,

    // preview frame — separates the reviewed page from the review tool
    previewLabel: 'Vista previa de la página — el contenido que estás revisando',
    previewHint: 'Enlaces y formularios desactivados',
    pvDesktop: 'Escritorio',
    pvMobile: 'Teléfono',
    linkNote: 'Ese enlace forma parte de la página que estás revisando — aquí los enlaces están desactivados. Haz clic en una sección para dejar tu comentario.',

    // sidebar / sections
    sections: 'Secciones',
    sectionsHint: 'Haz clic en una sección aquí — o directamente en la página — para aprobarla o dejar un comentario. Tu progreso se guarda automáticamente, así que puedes salir y volver cuando quieras.',
    comments: (n) => `${n} comentario${n > 1 ? 's' : ''}`,
    allSections: '‹ Todas las secciones',
    approve: 'Aprobar',
    approveNext: 'Aprobar y siguiente',
    approveFinish: 'Aprobar y finalizar',
    requestChanges: 'Solicitar cambios',
    changesShort: 'Cambios',
    noCommentsYet: 'Aún no hay comentarios.',
    noCommentsFirst: 'Aún no hay comentarios — agrega el primero abajo.',
    reviewer: 'Revisor',
    client: 'Cliente',
    reopen: 'Reabrir',
    markResolved: 'Marcar como resuelto',
    deleteComment: 'Eliminar comentario',
    confirmDeleteComment: '¿Eliminar este comentario?',
    confirmDeleteCommentBody: 'Se eliminará de la revisión para todos.',
    deleteShort: 'Eliminar',
    cancel: 'Cancelar',
    newBadge: 'Nuevo',

    // general (page-level) feedback — not tied to a single section
    generalTitle: 'Comentarios generales',
    generalHint: 'Ideas sobre la página en general — el tono, información que falte, cualquier cosa que no sea de una sección en concreto.',
    generalShort: 'General',
    addGeneralComment: 'Agregar comentario general',
    contactLine: (email) => (<>¿Tienes dudas? ¿Prefieres que lo hablemos? Escríbenos a <a href={`mailto:${email}`}>{email}</a>.</>),
    addComment: 'Agrega un comentario para esta sección…',
    addCommentFor: (name) => `Agrega un comentario para “${name}”…`,
    postComment: 'Publicar comentario',
    done: 'Listo',
    commentsLabel: 'Comentarios',
    prevSection: 'Sección anterior',
    nextSection: 'Sección siguiente',

    // finish-review choice — the client picks one of two outcomes
    finishTitle: 'Finaliza tu revisión',
    finishSummary: (a, ch, cm) =>
      `${a} aprobadas · ${ch} cambio${ch === 1 ? '' : 's'} solicitado${ch === 1 ? '' : 's'} · ${cm} comentario${cm === 1 ? '' : 's'}`,
    optApprove: 'Aprobar este contenido',
    optApproveSub: 'Te gusta como está — finalizaremos el contenido teniendo en cuenta tus comentarios.',
    optRevise: 'Solicitar una nueva versión',
    optReviseSub: (n) => n > 0
      ? `Incorporaremos ${n} cambio${n > 1 ? 's' : ''} solicitado${n > 1 ? 's' : ''} y te enviaremos una versión actualizada para revisar.`
      : 'Revisaremos el contenido según tus comentarios y te enviaremos una versión actualizada para revisar.',
    keepReviewing: 'Seguir revisando',
    autosaveNote: '¿No estás listo para finalizar? Tu progreso se guarda automáticamente — puedes cerrar esta página y volver cuando quieras usando el mismo enlace.',

    // thank-you page
    tyTitle: (name) => `¡Gracias${name ? `, equipo de ${name}` : ''}!`,
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
    tySummaryH: 'Resumen de tus comentarios',
    tyContinue: '¿Se te ocurrió algo más? Puedes reabrir la revisión y continuar justo donde lo dejaste.',
    tyReopen: 'Reabrir la revisión',

    // thank-you variant when the client chose "approve" (no revision loop)
    tyApprLead: (title) => (<>Aprobaste <b>{title}</b> — tenemos todo lo que necesitamos para finalizarlo.</>),
    tyApprBody:
      'Nuestro equipo le dará los últimos retoques, incorporará tus comentarios y llevará el contenido aprobado directamente a producción.',
    tyApprStep1: 'Hacemos una última revisión del contenido aprobado.',
    tyApprStep2: 'Lo usamos para construir tu página en vivo.',
    tyApprStep3: 'Recibirás el enlace en cuanto se publique.',

    // finalized screen — the agency accepted the content; the link is locked
    finalTitle: (client) => `¡Todo listo${client ? `, equipo de ${client}` : ''} — este contenido es definitivo!`,
    finalLead: (title) => (<>La revisión de <b>{title}</b> está cerrada — tu contenido aprobado ya se está convirtiendo en tu página en vivo.</>),
    finalBody:
      'No necesitas hacer nada más. Nuestro equipo está construyendo la página exactamente como fue aprobada — ' +
      'si surge cualquier cosa mientras tanto, solo escríbenos y nos encargamos.',
    finalNextH: 'Qué sigue ahora',
    finalStep1: 'Construimos tu página en vivo con el contenido aprobado.',
    finalStep2: 'Todo pasa por una revisión de calidad final en escritorio y móvil.',
    finalStep3: 'Recibirás el enlace en cuanto se publique.',
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
