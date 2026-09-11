import en from "./en";

const fr = {
  appName: "Antigravity Relay",
  common: {
    loading: "Chargement...",
    error: "Erreur",
    unknown: "Inconnu",
    notAvailable: "N/A",
    openMenu: "Ouvrir le menu",
    cancel: "Annuler",
  },
  status: {
    checking: "Verification du statut...",
    running: "Antigravity fonctionne en arriere-plan",
    stopped: "Service Antigravity arrete",
    services: "Services",
    apps: "Applications",
    antigravity: "Runtime Antigravity",
    relay: "Serveur Relay",
    tunnel: "Tunnel Cloudflare",
    dashboard_title: "Statut des services",
    open_dashboard: "Ouvrir le statut des services",
    checking_short: "Verification...",
    running_short: "En cours",
    stopped_short: "Arrete",
    all_running: "Tous les services fonctionnent",
    all_stopped: "Tous les services sont arretes",
    partial_running: "{{running}}/{{total}} services fonctionnent",
    not_installed_short: "Non installe",
    tunnel_not_installed_tooltip:
      "Le CLI cloudflared n est pas installe sur cet ordinateur",
    wifi_network: "Wi-Fi",
    local_network: "Local",
    service_relay: "Serveur Relay",
    service_tunnel: "Tunnel Cloudflare",
    service_app: "Antigravity App",
    service_ide: "Antigravity IDE",
    service_cli: "Antigravity CLI",
    tooltips: {
      appNotInstalled:
        "L application Antigravity n est pas detectee sur ce systeme",
      ideNotInstalled: "Antigravity IDE n est pas detecte sur ce systeme",
      cliNotInstalled:
        "L executable Antigravity CLI est introuvable dans PATH ou les dossiers standards",
      tunnelNotInstalled:
        "Le CLI cloudflared n est pas installe sur cet ordinateur",
      cliIdleGuidance:
        "Executez directement depuis le terminal via 'agy <commande>'",
    },
  },
  action: {
    stop: "Arreter",
    start: "Demarrer",
    switch: "Basculer",
    deleteBackup: "Supprimer la sauvegarde",
    backupCurrent: "Sauvegarder le compte actuel",
    retry: "Reessayer",
    details: "Details",
    openLogs: "Ouvrir le dossier des journaux",
    cancel: "Annuler",
  },
  update: {
    title: "Mises a jour",
    checking: "Verification...",
    checkNow: "Rechercher des mises a jour",
    checkFailed: "Impossible de rechercher des mises a jour",
    upToDate: "Vous etes a jour.",
    unsupported:
      "La recherche automatique de mises a jour n est pas disponible sur cette plateforme.",
    available: {
      title: "Mise a jour disponible",
      description: "La version {{version}} est disponible sur GitHub.",
      download: "Telecharger",
      downloading: "Telechargement...",
      dismiss: "Ignorer",
      macosUnsignedNote:
        "Cette version macOS n est pas officiellement signee. Si macOS bloque l app, suivez les etapes de signature manuelle dans le README GitHub ou les issues associees.",
    },
    downloaded: {
      title: "Mise a jour prete",
      description: "La version {{version}} a ete telechargee.",
      restart: "Redemarrer",
    },
  },
  error: {
    generic: "Une erreur inattendue s est produite.",
    detailsTitle: "Details de l erreur",
    detailsDescription:
      "Les details d erreur du backend sont affiches ci-dessous. Ils peuvent inclure des chemins de fichiers locaux et des frames de pile.",
    keychainUnavailable: "Le trousseau n est pas disponible.",
    keychainHint: {
      translocation:
        "Translocation d app macOS detectee. Deplacez l app vers /Applications puis rouvrez-la.",
      keychainDenied:
        "Acces au trousseau refuse. L app n est peut-etre pas signee ; consultez le README pour la solution de signature locale.",
      signNotarize:
        "Utilisez une version signee et notarisee lorsqu elle est disponible.",
    },
    dataMigrationFailed:
      "Impossible de dechiffrer les donnees de compte heritees.",
    masterKeyUnavailable:
      "Des comptes stockes ont ete trouves, mais leur cle de chiffrement est actuellement indisponible. Aucune donnee de compte ni aucun fichier de cle n a ete modifie.",
    dataMigrationHint: {
      relogin: "Reconnectez-vous ou ajoutez de nouveau vos comptes.",
      clearData:
        "Si le probleme persiste, effacez les donnees de compte locales et reconnectez-vous.",
    },
    antigravityStorageJsonNotFound:
      "Le fichier storage.json d Antigravity est introuvable. Ouvrez l app Antigravity cible et connectez-vous une fois, puis reessayez de basculer.",
    antigravityProjectIdMissing:
      "Il manque un ID de projet Antigravity a ce compte. Cela peut arriver si le compte ne s est jamais connecte a l app Antigravity. Connectez-vous une fois dans Antigravity, puis revenez dans cet outil et reessayez.",
    antigravityDatabasePermissionDenied:
      "Le stockage de base de donnees Antigravity n est pas accessible en ecriture. Verifiez le dossier de donnees utilisateur Antigravity configure ou redemarrez Antigravity Relay apres avoir ouvert Antigravity une fois.",
    cloudAccountLoginExpired:
      "Les informations de connexion de ce compte cloud ont expire. Veuillez vous reconnecter.",
    rootBoundary: {
      title: "L'application a rencontre une erreur",
      description:
        "Une erreur critique inattendue s'est produite. Vous pouvez recharger la fenetre de l'application pour retablir le fonctionnement normal.",
      reload: "Recharger l'application",
      copyDetails: "Copier les details de l'erreur",
      detailsCopied: "Details de l'erreur copies dans le presse-papiers.",
      viewDetails: "Afficher les diagnostics techniques",
      hideDetails: "Masquer les diagnostics techniques",
    },
    routeFallback: {
      title: "Impossible de charger la section",
      description:
        "Une erreur inattendue s'est produite lors du rendu de cette vue.",
      retry: "Reessayer la section",
      goHome: "Retourner aux comptes",
    },
  },
  nav: {
    accounts: "Comptes",
    relay: "Relais & À distance",
    settings: "Parametres",
  },
  remote: {
    title: "Contrôle à distance & Partage mobile",
    subtitle:
      "Serveur relais Fastify découplé et superviseur de tunnel Cloudflare pour une supervision mobile ininterrompue",
  },
  relay: {
    title: "Serveur relais local",
    subtitle: "Pont de commandes WebSocket local et hébergeur PWA statique",
    statusActive: "Actif",
    statusInactive: "Inactif",
    statusStarting: "Démarrage...",
    statusStopping: "Arrêt...",
    port: "Port : {{port}}",
    toggleStart: "Démarrer le serveur relais",
    toggleStop: "Arrêter le serveur relais",
    bufferLabel: "File de commandes",
    bufferCount: "{{count}} commandes en attente",
    bufferEmpty: "File vide (0 en attente)",
    upstreamTitle: "Pont du démon amont",
    upstreamConnected: "Connecté",
    upstreamReconnecting: "Reconnexion",
    upstreamBuffering: "Mise en mémoire tampon",
    upstreamOffline: "Hors ligne",
    startFailed: "Échec du démarrage du serveur relais : {{error}}",
    stopFailed: "Échec de l'arrêt du serveur relais : {{error}}",
    mirrorBoundary: {
      title: "Avis sur le perimetre de Remote Mirror",
      badge: "App et IDE uniquement",
      description:
        "Mobile Remote Mirror diffuse uniquement les sessions Antigravity App et Antigravity IDE. Antigravity CLI s execute exclusivement dans votre terminal et ne peut pas etre diffuse sur les appareils mobiles compagnons.",
      callout:
        "Antigravity CLI fonctionne directement sur cet hote et n est pas diffuse sur les appareils mobiles.",
    },
  },
  tunnel: {
    title: "Tunnel rapide Cloudflare",
    subtitle: "Tunnel public HTTPS/WSS sécurisé via trycloudflare.com",
    statusConnected: "Connecté",
    statusStarting: "Établissement du tunnel...",
    statusReconnecting: "Reconnexion du tunnel...",
    statusStopped: "Arrêté",
    statusError: "Erreur de tunnel",
    urlLabel: "URL publique du tunnel",
    urlPlaceholder: "En attente d'attribution du tunnel...",
    copyUrl: "Copier l'URL du tunnel",
    urlCopied: "URL du tunnel copiée dans le presse-papiers",
    restartTunnel: "Redémarrer le tunnel",
    restarting: "Redémarrage...",
    stop: "Arrêter le tunnel",
    stopping: "Arrêt...",
    start: "Démarrer le tunnel",
    starting: "Démarrage...",
    restartFailed: "Échec du redémarrage du tunnel : {{error}}",
    pid: "PID du processus : {{pid}}",
    startFailed: "Échec du démarrage du tunnel Cloudflare : {{error}}",
    stopFailed: "Échec de l'arrêt du tunnel Cloudflare : {{error}}",
    notInstalledBadge: "Non installé",
    missingBannerTitle: "CLI cloudflared introuvable",
    missingBannerDesc:
      "Le tunnel rapide Cloudflare nécessite l'exécutable cloudflared pour établir des tunnels sécurisés publics pour l'accès distant mobile.",
    installCommandLabel:
      "Commande d'installation recommandée pour {{platform}} :",
    installCommandLabelGeneric: "Commande d'installation :",
    copyCommand: "Copier",
    copied: "Copié",
    commandCopied: "Commande copiée dans le presse-papiers",
    checkAgain: "Vérifier à nouveau",
    checking: "Vérification...",
    binaryDetectedSuccess: "CLI cloudflared trouvé à {{path}}",
    binaryStillMissing:
      "cloudflared est toujours introuvable dans le PATH ou les dossiers standards",
    officialDocs: "Documentation officielle",
    startDisabledReason:
      "Impossible de démarrer le tunnel car l'exécutable cloudflared n'est pas installé sur ce système",
    missingTooltip:
      "L'exécutable cloudflared est manquant. Veuillez l'installer pour activer le tunnel distant.",
    binaryNotInstalledTooltip:
      "Le CLI cloudflared n'est pas installé sur cet ordinateur",
  },
  pairing: {
    title: "Appairage mobile & Accès QR",
    subtitle:
      "Scannez avec l'appareil photo de votre téléphone pour ouvrir le compagnon de télécommande",
    qrAlt: "Code QR pour l'appairage de la télécommande mobile",
    scanInstructions:
      "Scannez avec l'appareil photo du téléphone pour vous connecter",
    scanTip:
      "Scannez ce code QR avec l'appareil photo de votre mobile pour ouvrir la PWA associée.",
    securityNotice:
      "L'URL d'appairage comprend une clé d'authentification unique éphémère. Ne la partagez pas.",
    regenerateToken: "Régénérer la clé d'appairage",
    tokenLabel: "Clé d'appairage",
    copyToken: "Copier la clé",
    tokenCopied: "Clé d'appairage copiée dans le presse-papiers",
    modeTunnel: "Tunnel Cloudflare",
    modeWifi: "Wi-Fi local",
    wifiAdvisory:
      "Connectez votre téléphone au même réseau Wi-Fi pour accéder.",
    copyLink: "Copier le lien",
    linkCopied: "Lien d'appairage copié dans le presse-papiers",
    serverInactive: "Serveur relais inactif",
    startServerToPair:
      "Démarrez le serveur relais pour activer l'appairage mobile",
    keySingleUseBadge: "Usage unique par appareil",
    autoRegeneratedNotice:
      "Clé d'appairage régénérée automatiquement après connexion",
    keyConsumedError:
      "Cette clé d'appairage a déjà été utilisée par un autre appareil. Veuillez demander une nouvelle clé au host desktop.",
    keyInvalidError:
      "Clé d'appairage invalide. Veuillez vérifier la clé active sur votre tableau de bord desktop.",
    platformScopeNotice:
      "Le compagnon mobile diffuse uniquement les sessions Antigravity App et Antigravity IDE. Antigravity CLI n est pas pris en charge.",
  },
  sessions: {
    title: "Sessions mobiles connectées",
    subtitle:
      "Connexions de contrôle à distance mobiles actives autorisées via le relais local",
    countSingular: "1 session",
    countPlural: "{{count}} sessions",
    countAria: "{{count}} sessions associées",
    colDevice: "Appareil / Client",
    colIp: "Adresse IP",
    colDuration: "Connecté depuis",
    colLastActive: "Dernière activité",
    colActions: "Actions",
    deviceIdTooltip: "ID de l'appareil : {{id}} (cliquez pour copier)",
    copyDeviceIdAria: "Copier l'ID de l'appareil {{id}}",
    deviceIdCopied: "ID de l'appareil copié dans le presse-papiers",
    relativeJustNow: "à l'instant",
    relativeSecondsAgo: "il y a {{count}}s",
    relativeMinutesAgo: "il y a {{count}}m",
    relativeHoursAgo: "il y a {{count}}h",
    deviceAndroid: "Appareil Android",
    deviceIPhone: "iPhone",
    deviceIPad: "iPad",
    deviceMac: "Mac",
    deviceWindows: "PC Windows",
    deviceLinux: "PC Linux",
    unknownDevice: "Appareil mobile",
    unknownBrowser: "Navigateur Web",
    revoke: "Révoquer",
    revoking: "Révocation...",
    revokeTooltip: "Terminer la session et couper la connexion",
    revokeAriaLabel: "Révoquer la session pour {{device}} sur {{ip}}",
    confirmRevokeTitle: "Révoquer la session mobile ?",
    confirmRevokeMessage:
      "Voulez-vous vraiment révoquer la session pour {{device}} ({{ip}}) ? La connexion mobile sera interrompue immédiatement.",
    confirmRevokeAction: "Confirmer la révocation",
    emptyTitle: "Aucun appareil mobile connecté",
    emptyDescription:
      "Scannez le code QR d'appairage ci-dessus avec votre smartphone pour associer votre première session distante.",
    revokedToast: "La session pour {{device}} a été révoquée",
    revokeFailed: "Échec de la révocation de la session : {{error}}",
  },
  revocation: {
    screenHeading: "Accès révoqué par l'hôte",
    screenDescription:
      "Cette session d'appareil a été interrompue par l'hôte desktop. Veuillez saisir une clé d'appairage valide pour rétablir votre connexion.",
    overlayBadge: "Déconnecté par l'hôte",
    inputLabel: "Nouvelle clé d'appairage",
    inputPlaceholder: "Entrez une nouvelle clé d'appairage",
    reconnectButton: "Reconnecter l'appareil",
    reconnecting: "Authentification en cours...",
    reconnectedSuccess: "Appareil reconnecté avec succès !",
    reconnectButtonAria:
      "Soumettre la nouvelle clé d'appairage pour reconnecter cet appareil révoqué",
    staleKeyError:
      "La clé d'appairage précédente n'est plus valide. Saisissez la nouvelle clé affichée sur le tableau de bord desktop.",
    emptyKeyError: "Veuillez saisir une clé d'appairage avant de soumettre.",
    rateLimitedError:
      "Trop de tentatives d'appairage. Veuillez patienter un moment avant de réessayer.",
    networkError:
      "Impossible de joindre le serveur relais. Veuillez vérifier votre connexion réseau.",
    syncingSiblingTabs:
      "Appareil réassocié avec succès. Synchronisation des onglets ouverts...",
    fallbackTitle: "Session révoquée - Antigravity Relay",
    fallbackNotice:
      "Session révoquée : L'accès a été révoqué par l'hôte desktop. Veuillez saisir une clé d'appairage valide pour rétablir votre connexion.",
  },
  traySync: {
    switchedTitle: "Compte bascule",
    switchedDescription:
      "Compte actif bascule vers {{email}} via la barre d etat.",
    switchedAllTitle: "Tous les environnements bascules",
    switchedAllDescription:
      "Tous les environnements ont ete bascules vers {{email}} via la zone de notification.",
    switchedTargetTitle: "Compte bascule",
    switchedTargetDescription:
      "L environnement {{target}} a ete bascule vers {{email}} via la zone de notification.",
  },
  account: {
    current: "Actuel",
    lastUsed: "Derniere utilisation {{time}}",
    switchToAntigravity: "Basculer vers Antigravity",
    switchToIde: "Basculer vers Antigravity IDE",
  },
  home: {
    title: "Comptes",
    description: "Gerez vos comptes Google Gemini Antigravity.",
    noBackups: {
      title: "Aucune sauvegarde trouvee",
      description:
        "Creez une sauvegarde de votre compte Antigravity actuel pour commencer.",
      action: "Sauvegarder le compte actuel",
    },
  },
  settings: {
    "weekly-warmup": {
      error: "Impossible de charger ou enregistrer les paramètres.",
      retry: "Réessayer",
      "cost-notice":
        "Le préchauffage consomme du quota et peut utiliser des crédits IA. Une réponse HTTP acceptée ne garantit pas un nouveau cycle hebdomadaire.",
      title: "Préchauffage du quota hebdomadaire",
      description:
        "Après la réinitialisation d’un quota sélectionné, envoie une requête minimale par compartiment et mémorise les cycles réussis.",
      enabled: "Activer le préchauffage hebdomadaire",
      groups: "Groupes de quotas à préchauffer",
      group: {
        claude: "Groupes de quotas Claude",
        gemini: "Groupes de quotas Gemini",
      },
    },
    title: "Parametres",
    description: "Gerez les preferences de l application.",
    general: "General",
    connection: "Connexion",
    models: "Modeles",
    appearance: {
      title: "Apparence",
      description:
        "Personnalisez l apparence d Antigravity Relay sur votre appareil.",
    },
    darkMode: "Mode sombre",
    darkModeDescription:
      "Activez le mode sombre pour un meilleur confort la nuit.",
    language: {
      title: "Langue",
      description: "Selectionnez votre langue preferee.",
      english: "Anglais",
      chinese: "Chinois (simplifie)",
      russian: "Russe",
      vietnamese: "Vietnamien",
      turkish: "Turc",
      french: "Français",
      indonesian: "Indonésien",
    },
    about: {
      title: "A propos",
      description: "Informations sur l application.",
    },
    cache: {
      title: "Cache Antigravity App",
      description:
        "Effacez les dossiers de cache connus d Antigravity App pour résoudre les problèmes de connexion ou de validation de version.",
      clear: "Effacer le cache Antigravity App",
      dialogTitle: "Effacer le cache Antigravity App ?",
      dialogDescription:
        "Les dossiers de cache existants suivants seront supprimés.",
      pathsLabel: "Dossiers de cache",
      noPaths: "Aucun dossier de cache Antigravity App connu n a été trouvé.",
      warning:
        "Fermez Antigravity App avant le nettoyage afin d éviter les fichiers verrouillés.",
      cancel: "Annuler",
      confirm: "Effacer le cache",
      clearing: "Nettoyage...",
      clearedTitle: "Cache effacé",
      clearedDescription:
        "{{size}} Mo ont été supprimés des dossiers de cache Antigravity App.",
      failedTitle: "Échec du nettoyage du cache",
      notFoundTitle: "Aucun cache Antigravity App trouvé",
    },
    version: "Version",
    platform: "Plateforme",
    license: "Licence",
    openLogDir: "Ouvrir",
    toast: {
      saved: {
        title: "Parametres enregistres",
        description: "Votre configuration a ete mise a jour.",
      },
      saveFailed: {
        title: "Erreur lors de l enregistrement des parametres",
      },
    },
    account: {
      title: "Parametres du compte",
      description:
        "Configurez l actualisation et la synchronisation automatiques des comptes.",
      auto_refresh: "Actualisation automatique du quota",
      auto_refresh_desc:
        "Actualiser regulierement les informations de quota de tous les comptes",
      auto_sync: "Synchronisation automatique du compte actuel",
      auto_sync_desc:
        "Synchroniser regulierement les informations du compte actif",
      antigravity_executable: "Executable Antigravity App",
      antigravity_executable_desc:
        "Chemin facultatif utilise pour trouver les donnees du mode portable et lancer Antigravity App.",
      antigravity_executable_placeholder:
        "Exemple : C:\\Program Files\\Antigravity\\Antigravity.exe",
      antigravity_args: "Arguments de lancement Antigravity App",
      antigravity_args_desc:
        "Arguments facultatifs transmis au lancement d Antigravity App, comme --user-data-dir.",
      antigravity_args_placeholder:
        "Exemple : --user-data-dir D:\\AntigravityProfile",
      detect_antigravity_args: "Detecter",
    },
    runtimes: {
      title: "Environnements d execution",
      description:
        "Configurez les chemins des executables et les arguments de lancement des environnements Antigravity.",
      target_app: "Antigravity App",
      target_ide: "Antigravity IDE",
      target_cli: "Antigravity CLI (agy)",
      browse: "Parcourir",
      clear: "Effacer",
      detect: "Detecter",
      detecting: "Detection...",
      auto_detect_all: "Tout auto-detecter",
      auto_detect_all_aria:
        "Detecter automatiquement tous les executables Antigravity installes",
      detect_exec: "Detecter",
      app: {
        title: "Antigravity App",
        executable: "Executable Antigravity App",
        executable_desc:
          "Chemin utilise pour trouver les donnees du mode portable et lancer Antigravity App.",
        executable_placeholder:
          "Exemple : C:\\Program Files\\Antigravity\\Antigravity.exe",
        args: "Arguments de lancement Antigravity App",
        args_desc:
          "Arguments facultatifs transmis au lancement d Antigravity App, comme --user-data-dir.",
        args_placeholder: "Exemple : --user-data-dir D:\\AntigravityProfile",
        browse_aria: "Parcourir pour trouver l executable Antigravity App",
        clear_path_aria: "Effacer le chemin de l executable Antigravity App",
        clear_args_aria: "Effacer les arguments de lancement d Antigravity App",
        detect_args: "Detecter",
        detect_args_aria:
          "Detecter les arguments de lancement depuis Antigravity App en cours d execution",
        detect_exec_aria: "Detecter l executable Antigravity App installe",
      },
      ide: {
        title: "Antigravity IDE",
        executable: "Executable Antigravity IDE",
        executable_desc:
          "Chemin utilise pour localiser et lancer les installations portables ou personnalisees d Antigravity IDE.",
        executable_placeholder:
          "Exemple : D:\\Tools\\AntigravityIDE\\AntigravityIDE.exe",
        args: "Arguments de lancement Antigravity IDE",
        args_desc:
          "Arguments facultatifs transmis au lancement d Antigravity IDE, comme un dossier de donnees ou d extensions.",
        args_placeholder:
          "Exemple : --user-data-dir D:\\Tools\\AntigravityIDE\\data",
        browse_aria: "Parcourir pour trouver l executable Antigravity IDE",
        clear_path_aria: "Effacer le chemin de l executable Antigravity IDE",
        clear_args_aria: "Effacer les arguments de lancement d Antigravity IDE",
        detect_args: "Detecter",
        detect_args_aria:
          "Detecter les arguments de lancement depuis Antigravity IDE en cours d execution",
        detect_exec_aria: "Detecter l executable Antigravity IDE installe",
      },
      cli: {
        title: "Antigravity CLI (agy)",
        executable: "Executable Antigravity CLI (agy)",
        executable_desc:
          "Chemin utilise pour localiser le binaire agy lorsqu il n est pas present dans le PATH du systeme.",
        executable_placeholder:
          "Exemple : /usr/local/bin/agy ou ~/.local/bin/agy",
        browse_aria: "Parcourir pour trouver l executable Antigravity CLI",
        clear_path_aria: "Effacer le chemin de l executable Antigravity CLI",
        detect_exec_aria:
          "Detecter l executable Antigravity CLI (agy) installe",
      },
      toast: {
        success_title: "Arguments detectes",
        success_desc:
          "Arguments de lancement detectes et appliques depuis {{target}} en cours d execution.",
        empty_title: "Arguments par defaut actifs",
        empty_desc:
          "{{target}} s execute avec les arguments par defaut (aucun argument detecte).",
        not_running_title: "Processus non lance",
        not_running_desc:
          "Aucun processus {{target}} en cours d execution n a ete detecte. Les arguments existants sont conserves.",
        error_title: "Echec de la detection",
        error_desc:
          "Impossible d inspecter les arguments du processus en cours d execution pour {{target}}.",
        exec_detected_title: "Executable detecte",
        exec_detected_desc: "{{target}} detecte et configure sur {{path}}.",
        exec_not_found_title: "Executable introuvable",
        exec_not_found_desc:
          "Aucun executable {{target}} installe n a ete trouve sur votre systeme.",
        exec_already_set_title: "Deja configure",
        exec_already_set_desc:
          "{{target}} est deja configure avec le chemin detecte.",
        exec_preserved_title: "Chemin conserve",
        exec_preserved_desc: "Le chemin actuel de {{target}} a ete conserve.",
        exec_bulk_summary_title: "Auto-detection terminee",
        exec_bulk_summary_desc:
          "{{count}} executable(s) d environnement configure(s).",
        exec_bulk_unchanged_desc:
          "Tous les environnements installes sont deja configures.",
        exec_bulk_none_desc:
          "Aucun executable Antigravity installe n a ete detecte sur ce systeme.",
      },
      dialog: {
        replace_title: "Remplacer le chemin de l executable ?",
        replace_desc:
          "Remplacer le chemin configure pour {{target}} par le chemin detecte ?",
        batch_title: "Conflits de chemins d executables",
        batch_desc:
          "Les chemins detectes different de vos configurations actuelles. Selectionnez les chemins a remplacer.",
        current_label: "Chemin actuel",
        detected_label: "Chemin detecte",
        replace_all: "Tout remplacer",
        replace_selected: "Remplacer la selection",
        keep_current: "Conserver l existant",
      },
    },
    startup: {
      title: "Demarrage",
      description:
        "Controlez le comportement de lancement au demarrage du systeme.",
      auto_startup: "Demarrer avec le systeme",
      auto_startup_desc:
        "Lancer a la connexion et garder l app dans la zone de notification",
      start_in_tray: "Demarrer dans la zone de notification",
      start_in_tray_desc:
        "Demarrer l'application reduite dans la zone de notification",
      macos_hint:
        "macOS exige une app signee pour que les elements de connexion fonctionnent. Si le demarrage automatique echoue, signez l app ou activez-la manuellement dans les reglages systeme.",
    },
    notifications: {
      title: "Notifications",
      description:
        "Configurez les alertes de bureau pour les evenements de compte.",
      quotaAlert: "Alertes de quota faible",
      quotaAlertDesc:
        "Recevoir une notification quand le quota d un modele passe sous le seuil defini",
      quotaThreshold: "Seuil d alerte",
      quotaThresholdDesc: "Pourcentage en dessous duquel declencher une alerte",
      saveFailed: "Echec de l enregistrement des parametres de notification",
      thresholdSaveFailed: "Echec de l enregistrement du seuil",
      aiCreditsAlert: "Alerte de credits IA faibles",
      aiCreditsAlertDesc:
        "Recevoir une notification quand le solde de credits IA atteint ou passe sous le seuil defini",
      aiCreditsThreshold: "Seuil d alerte de credits IA",
      aiCreditsThresholdDesc:
        "Montant de credits en dessous ou egal auquel declencher une alerte",
      aiCreditsThresholdSaveFailed:
        "Echec de l enregistrement du seuil de credits IA",
    },
    proxy: {
      title: "Proxy amont",
      description:
        "Configurez un proxy pour les requetes sortantes vers les API Google/Gemini.",
      enable: "Activer le proxy amont",
      url: "URL du proxy",
      timeout: "Delai de requete (secondes)",
    },
    modelMapping: {
      title: "Mappage des modeles",
      description:
        "Mappez les modeles Claude Code vers les modeles Antigravity. Optimisez cout et vitesse en routant les requetes intelligemment.",
      claudeKeyword: "Modele Claude (mot-cle)",
      targetGemini: "Modele Gemini cible",
      addPlaceholderKey: "ex. op-3",
      addPlaceholderValue: "ex. gemini-3-flash",
      noMappings: "Aucun mappage personnalise defini.",
      mapsTo: "Mappe vers",
      default: "Par defaut",
      restoreDefaults: "Restaurer les valeurs par defaut",
    },
    modelVisibility: {
      title: "Visibilite des modeles",
      description:
        "Controlez les modeles visibles dans les cartes de compte. Les modeles masques n apparaitront pas dans l affichage du quota.",
      searchPlaceholder: "Rechercher des modeles...",
      showAll: "Tout afficher",
      hideAll: "Tout masquer",
      reset: "Reinitialiser par defaut",
      save: "Enregistrer les modifications",
      noModels: "Aucun modele trouve",
      modelsShown: "{{visible}} sur {{total}} modeles visibles",
      quotaManagement: "Gestion des quotas",
      hidden: "Masque",
      noModelsFound: "Aucun modele trouve",
      totalModels: "Total",
      visibleModels: "Visibles",
      hiddenModels: "Masques",
      saving: "Enregistrement...",
    },
    autoSwitchModels: {
      title: "Auto-Switch Models Config",
      description:
        "Configure which models trigger auto-switch when depleted, and prioritize specific models when selecting the next active account.",
      searchPlaceholder: "Search models...",
      noModels: "No models found.",
      noModelsFound: "No models found.",
      includeLabel: "Include",
      priorityLabel: "Priority",
      save: "Save Config",
      saving: "Saving...",
      saved: "Auto-switch model configuration saved successfully.",
      saveFailed: "Failed to save auto-switch model configuration.",
    },
    providerGroupings: {
      title: "Groupements de fournisseurs",
      description:
        "Regrouper les modeles par fournisseur pour une meilleure organisation",
      enabled: "Activer les groupements de fournisseurs",
      models: "{{count}} modeles",
      avgLabel: "moy.",
      resetLabel: "reset",
      overall: "Global",
      healthy: "Sain",
      degraded: "Degrade",
      limited: "Limite",
      critical: "Critique",
    },
    save: "Enregistrer les parametres",
  },
  toast: {
    backupSuccess: {
      title: "Succes",
      description: "Sauvegarde du compte creee avec succes.",
    },
    backupError: {
      title: "Erreur",
      description: "Echec de la creation de la sauvegarde : {{error}}",
    },
    switchSuccess: {
      title: "Succes",
      description: "Compte bascule avec succes.",
    },
    switchError: {
      title: "Erreur",
      description: "Echec du basculement de compte : {{error}}",
    },
    deleteSuccess: {
      title: "Succes",
      description: "Sauvegarde du compte supprimee avec succes.",
    },
    deleteError: {
      title: "Erreur",
      description: "Echec de la suppression de la sauvegarde : {{error}}",
    },
  },
  cloud: {
    title: "Comptes",
    description: "Gerez votre pool de comptes Google Gemini.",
    summary: {
      statusUnified: "Unifié (1 actif)",
      statusUnifiedSubtitle: "Tous les environnements sont synchronisés",
      statusDiverged: "Divergence ({{count}} cibles séparées)",
      statusDivergedSubtitle:
        "Les environnements utilisent des comptes différents",
    },
    divergedBanner: {
      title: "Environnements désynchronisés",
      description:
        "Les environnements utilisent des comptes différents : {{targets}}",
      strandedWarning:
        "La cible {{target}} est bloquée sur un compte limité en quota.",
      resyncAction: "Resynchroniser tous les environnements sur {{email}}",
      resyncActionDefault: "Resynchroniser tous les environnements",
      resyncing: "Resynchronisation...",
    },
    security: {
      compatibilityMode: {
        title: "Le stockage de cle de compatibilite est actif",
        description:
          "Les donnees du compte restent chiffrees avec AES-256-GCM, mais la cle principale est stockee localement au lieu d etre protegee par le service d identifiants du systeme.",
      },
    },
    autoSwitch: "Basculement auto",
    providerGroupings: "Groupements de fournisseurs",
    addAccount: "Ajouter un compte",
    addAccountDisabledTooltip:
      "Les identifiants du client OAuth ne sont pas configurés. Définissez ANTIGRAVITY_OAUTH_CLIENT_ID et ANTIGRAVITY_OAUTH_CLIENT_SECRET pour activer.",
    syncFromIde: "Synchroniser depuis Antigravity",
    syncFromAntigravity: "Synchroniser depuis Antigravity",
    checkQuota: "Verifier le quota maintenant",
    polling: "Interrogation declenchee",
    globalQuota: "Quota global",
    layout: {
      auto: "Auto",
      twoCol: "2 colonnes",
      threeCol: "3 colonnes",
      list: "Liste",
      compact: "Compact",
    },
    "quota-window": {
      label: "Période de quota",
      "five-hours": "Quota sur 5 heures",
      "five-hours-short": "5 h",
      weekly: "Quota hebdomadaire",
      "weekly-short": "Semaine",
      "no-weekly-quota": "Aucune donnée de quota hebdomadaire",
      "weekly-summary-unavailable":
        "Le service en amont n'a renvoyé aucun résumé de quota hebdomadaire.",
      "weekly-bucket-unavailable":
        "Le résumé du quota ne contient aucun compartiment hebdomadaire reconnu.",
    },
    authDialog: {
      title: "Ajouter un compte Google",
      description:
        "Pour ajouter un compte, vous devez autoriser l application.",
      missingCredentialsBanner:
        "Les variables d'environnement OAuth ne sont pas configurées. L'ajout de compte est indisponible.",
      unconfiguredWarning:
        "Les variables d'environnement OAuth ne sont pas configurées. L'ajout de compte est indisponible.",
      clientNotConfiguredBadge: "Non configuré",
      unconfiguredBadge: "Non configuré",
      selectedClientNotConfiguredWarning:
        "Le client OAuth sélectionné n'est pas configuré.",
      clientUnconfigured: "Le client OAuth sélectionné n'est pas configuré.",
      oauthClient: "Client OAuth",
      oauthClientPlaceholder: "Selectionner un client OAuth",
      openLogin: "Ouvrir la page de connexion",
      authCode: "Code d autorisation",
      placeholder: "Collez le code commencant par 4/...",
      instruction:
        "Le navigateur par defaut s ouvrira pour la connexion Google. Copiez le code depuis la page localhost et collez-le ici.",
      verify: "Verifier et ajouter",
    },
    localImport: en.cloud.localImport,
    target: {
      app: "Application Antigravity",
      appShort: "App",
      classic: "Application Antigravity",
      classicShort: "App",
      ide: "Antigravity IDE",
      ideShort: "IDE",
      cli: "Antigravity CLI",
      cliShort: "CLI",
      agy: "Antigravity CLI",
      agyShort: "CLI",
    },
    switch: {
      targetAll: "Basculer pour tous les environnements",
      targetAllDesc:
        "Synchronisez les identifiants sur App, IDE et CLI en un seul clic",
      targetAllShort: "Tout basculer",
      activeAll: "Actif partout",
      activeAllAria: "Actif sur tous les environnements: App, IDE et CLI",
      trigger: "Basculer",
      triggerAria: "Basculer le compte actif pour {{email}}",
      menuTitle: "Selectionner l environnement cible",
      switchToTarget: "Basculer pour {{target}}",
      activeBadge: "Actif",
      currentlyActiveAria: "{{target}} est actuellement actif",
      switching: "Bascule en cours...",
      targetNotInstalled: "{{target}} n est pas installe sur ce systeme",
      cliHint: "Outil terminal : s'applique aux nouvelles sessions",
      successAllToast: {
        title: "Tous les environnements bascules",
        description: "Tous les environnements ont ete bascules vers {{email}}.",
      },
      partialFailureToast: {
        title: "Bascule partielle terminee",
        description:
          "{{successCount}} environnements sur {{totalCount}} bascules vers {{email}}. Echec pour {{failedTargets}}: {{error}}",
      },
      failureAllToast: {
        title: "Echec de bascule",
        description: "Impossible de basculer les environnements: {{error}}",
      },
      noticeRestarted: "Identifiants appliques. {{target}} redemarre.",
      noticeInjectedOnDisk:
        "Identifiants mis a jour sur le disque pour {{target}}. Les modifications prendront effet au prochain lancement.",
      noticeCliUpdated:
        "Identifiants CLI mis a jour. Pret pour votre prochaine commande de terminal.",
      noticeBatchAllRestarted:
        "Identifiants appliques. Les environnements en cours d execution ont ete redemarres.",
      noticeBatchAllInjected:
        "Identifiants mis a jour sur le disque pour tous les environnements. Les modifications prendront effet au prochain lancement.",
      noticeBatchMixed:
        "Identifiants mis a jour: redemarrage de {{restartedTargets}}, mise a jour sur le disque pour {{injectedTargets}}.",
    },
    card: {
      active: "Actif",
      use: "Utiliser",
      rateLimited: "Limite par le debit",
      validationRiskControlled: "Risque / limite par le debit",
      validationOAuthReauthRequired: "Reauthentification OAuth requise",
      validationRequired: "Verification requise",
      completeValidation: "Verifier",
      left: "restant",
      used: "Utilise",
      unknown: "Utilisateur inconnu",
      actions: "Actions",
      useAccount: "Utiliser le compte",
      identityProfile: "Profil d identite",
      refresh: "Actualiser le quota",
      delete: "Supprimer le compte",
      noQuota: "Aucune donnee de quota",
      rateLimitedQuota: "Limite par le debit",
      liveLimitModelNotSupported: "Modèle non pris en charge",
      liveLimitModelForbidden: "Modèle interdit",
      liveLimitQuotaExhausted: "Quota épuisé",
      liveLimitRateLimited: "Débit limité",
      liveLimitRemaining: "{{duration}} restantes",
      liveLimitDetectedAgo: "détecté il y a {{duration}}",
      liveLimitActiveTitle:
        "Le point de terminaison amont est temporairement indisponible.",
      liveLimitRecentTitle:
        "Le point de terminaison amont a récemment renvoyé une erreur.",
      liveLimitQuotaSnapshot:
        "Le quota affiché peut encore indiquer {{percentage}} %.",
      liveLimitMessage: "Message : {{message}}",
      resetPrefix: "reset",
      resetTime: "Heure de reinitialisation",
      resetUnknown: "Inconnue",
      detailedQuota: "Quota detaille",
      quotaGroupUnknown: "Groupe de quota",
      gemini3Ready: "Pret pour Gemini 3",
      groupGoogleGemini: "Google Gemini",
      groupAnthropicClaude: "Anthropic Claude",
      proxy: "Proxy",
      proxyPlaceholder: "ex. http://127.0.0.1:7890",
      proxySaved: "Proxy enregistre",
      noProxy: "Aucun proxy",
      aiCredits: "Credits IA",
      aiCreditsValue: "{{amount}} credits",
      creditsExpiry: "expire le {{date}}",
      modelVisibility: "Visibilite des modeles",
    },
    identity: {
      title: "Profil d identite",
      loading: "Chargement...",
      generateAndBind: "Creer et associer",
      captureAndBind: "Capturer et associer l actuel",
      restoreOriginal: "Restaurer la base",
      openFolder: "Ouvrir le stockage d identite",
      previewTitle: "Apercu de l identite generee",
      confirm: "Confirmer",
      cancel: "Annuler",
      close: "Fermer",
      currentStorage: "Identite d execution actuelle",
      accountBinding: "Identite associee au compte",
      history: "Historique des identites",
      noHistory: "Aucun historique d identite",
      current: "Actif",
      restore: "Restaurer",
      generateSuccess: "Identite creee et associee",
      captureSuccess: "Identite actuelle capturee et associee",
      restoreOriginalSuccess: "Identite de base restauree",
      restoreVersionSuccess: "Identite historique restauree",
      deleteVersionSuccess: "Identite historique supprimee",
      openFolderSuccess: "Stockage d identite ouvert",
      baseline: "Identite de base",
    },
    list: {
      noAccounts: "Aucun compte cloud ajoute pour le moment.",
      noFilteredAccounts:
        "Aucun compte ne correspond aux niveaux selectionnes.",
    },
    error: {
      loadFailed: "Echec du chargement des comptes cloud.",
      dataRepair: {
        title: "Les donnees de compte chiffrees doivent etre reparees",
        description:
          "L app n a pas pu dechiffrer les donnees de compte locales. Cela signifie generalement que les donnees ont ete creees avec une autre cle de chiffrement ou qu elles sont corrompues.",
        stepReLogin:
          "Si la cle ne peut toujours pas etre recuperee, reconnectez-vous ou ajoutez de nouveau les comptes affectes sans supprimer la base de donnees existante.",
        stepMacPrivacy:
          "Sur macOS, verifiez les invites du trousseau et de confidentialite. Si l app n est pas signee ou a ete resignee, signez-la de nouveau, deplacez-la vers /Applications, puis rouvrez-la.",
        stepCheckGithub:
          "Consultez le README du depot GitHub pour les dernieres etapes de depannage.",
        stepOpenIssue:
          "Recherchez cette erreur dans les GitHub Issues avant d effacer les donnees de compte locales.",
        openRepository: "Ouvrir le depot GitHub",
        openIssues: "Ouvrir les GitHub Issues",
      },
    },
    toast: {
      resyncSuccessTitle: "Environnements resynchronisés",
      resyncSuccessDesc:
        "Tous les environnements sont synchronisés sur {{email}}.",
      resyncPartialTitle: "Resynchronisation partielle",
      resyncPartialDesc:
        "Basculé pour {{succeeded}}, mais échec pour {{failed}}.",
      resyncFailedTitle: "Échec de la resynchronisation",
      allAccountsExhaustedTitle: "Tous les comptes sont limités",
      allAccountsExhaustedDesc:
        "Tous les comptes de votre pool sont actuellement limités par le quota. Ajoutez un compte ou attendez la réinitialisation.",
      syncSuccess: {
        title: "Synchronisation reussie",
        description: "{{email}} importe depuis l IDE.",
      },
      syncFailed: {
        title: "Echec de la synchronisation",
        description: "Aucun compte actif trouve dans la base de donnees IDE.",
      },
      addSuccess: "Compte ajoute avec succes !",
      addFailed: {
        title: "Echec de l ajout du compte",
      },
      quotaRefreshed: "Quota actualise",
      refreshFailed: "Echec de l actualisation du quota",
      pollFailed: "Echec de l interrogation du quota pour tous les comptes",
      switched: {
        title: "Compte bascule !",
        description: "Redemarrage d Antigravity...",
      },
      switchFailed: "Echec du basculement de compte",
      deleted: "Compte supprime",
      deleteFailed: "Echec de la suppression du compte",
      deleteConfirm: "Voulez-vous vraiment supprimer ce compte ?",
      autoSwitchOn: "Basculement auto active",
      autoSwitchOff: "Basculement auto desactive",
      updateSettingsFailed: "Echec de la mise a jour des parametres",
      actionFailed: "Action echouee",
      startAuthFailed: "Echec du demarrage du flux de connexion",
      refreshCreditsAvailable: "Credits IA : {{amount}}",
      refreshCreditsUnavailable:
        "Credits IA indisponibles pour cette actualisation.",
      batchRefreshSuccess: "{{count}} comptes actualises avec succes.",
      batchRefreshPartial: {
        title: "Actualisation terminee avec des problemes",
        description: "{{successful}} comptes actualises, {{failed}} en echec.",
      },
      batchDeleteSuccess: "{{count}} comptes supprimes avec succes.",
      batchDeletePartial: {
        title: "Suppression terminee avec des problemes",
        description: "{{successful}} comptes supprimes, {{failed}} en echec.",
      },
    },
    batch: {
      selected: "{{count}} selectionnes",
      delete: "Supprimer la selection",
      refresh: "Actualiser la selection",
      selectAll: "Tout selectionner",
      clear: "Effacer la selection",
      confirmDelete: "Voulez-vous vraiment supprimer {{count}} comptes ?",
    },
    tierFilter: {
      all: "Tous les niveaux",
      reset: "Reinitialiser a tous",
      selectedCount: "{{count}} niveaux",
      unknown: "Inconnu",
    },
    sort: {
      recentlyUsed: "Recemment utilises",
      quotaOverall: "Quota global",
      quotaClaude: "Quota Claude",
      quotaPro3: "Quota Pro3",
      quotaFlash: "Quota Flash",
    },
    exportImport: {
      export: "Exporter",
      import: "Importer",
      exportTitle: "Exporter les comptes",
      exportDesc:
        "Choisissez d inclure ou non les jetons d authentification dans le fichier exporte.",
      includeTokens: "Inclure les jetons (moins securise)",
      stripTokens: "Retirer les jetons (plus sur pour le partage)",
      exportSuccess: "Comptes exportes avec succes",
      importTitle: "Importer des comptes",
      importDesc: "Selectionnez un fichier JSON exporte precedemment.",
      importStrategy: "Strategie d importation",
      strategyMerge: "Fusionner - mettre a jour l existant, ajouter le nouveau",
      strategyOverwrite: "Ecraser - remplacer toutes les donnees existantes",
      strategySkip: "Ignorer - ajouter seulement les nouveaux comptes",
      importSuccess:
        "{{imported}} importes, {{updated}} mis a jour, {{skipped}} ignores",
      importErrors: "Importation terminee avec {{count}} erreur(s)",
      selectFile: "Selectionner un fichier",
      importing: "Importation...",
      fileTooLarge: "La taille du fichier depasse la limite de 5 Mo",
      invalidJson: "Format de fichier JSON invalide",
      readFileFailed: "Echec de la lecture du fichier",
    },
  },
} satisfies typeof en;

export default fr;
