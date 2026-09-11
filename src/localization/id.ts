const id = {
  appName: "Antigravity Relay",
  common: {
    loading: "Memuat...",
    error: "Kesalahan",
    unknown: "Tidak Diketahui",
    notAvailable: "T/A",
    openMenu: "Buka menu",
    cancel: "Batal",
  },
  status: {
    checking: "Memeriksa status...",
    running: "Antigravity berjalan di latar belakang",
    stopped: "Layanan Antigravity berhenti",
    services: "Layanan",
    apps: "Aplikasi",
    antigravity: "Runtime Antigravity",
    relay: "Server Relay",
    tunnel: "Tunnel Cloudflare",
    dashboard_title: "Status layanan",
    open_dashboard: "Buka status layanan",
    checking_short: "Memeriksa...",
    running_short: "Berjalan",
    stopped_short: "Berhenti",
    all_running: "Semua layanan berjalan",
    all_stopped: "Semua layanan berhenti",
    partial_running: "{{running}}/{{total}} layanan berjalan",
    not_installed_short: "Belum Terpasang",
    tunnel_not_installed_tooltip:
      "CLI cloudflared belum terpasang di komputer ini",
    wifi_network: "Wi-Fi",
    local_network: "Lokal",
    service_relay: "Server Relay",
    service_tunnel: "Tunnel Cloudflare",
    service_app: "Antigravity 2.0 (App)",
    service_ide: "Antigravity IDE",
    service_cli: "Antigravity CLI (agy)",
    tooltips: {
      appNotInstalled:
        "Aplikasi desktop Antigravity 2.0 tidak terdeteksi di sistem ini",
      ideNotInstalled: "Antigravity IDE tidak terdeteksi di sistem ini",
      cliNotInstalled:
        "Eksekusi Antigravity CLI (agy) tidak ditemukan di PATH atau direktori standar",
      tunnelNotInstalled: "CLI cloudflared belum terpasang di komputer ini",
      cliIdleGuidance:
        "Jalankan langsung dari terminal melalui 'agy <perintah>'",
    },
  },
  action: {
    stop: "Berhenti",
    start: "Mulai",
    switch: "Ganti",
    deleteBackup: "Hapus Cadangan",
    backupCurrent: "Cadangkan Saat Ini",
    retry: "Coba Lagi",
    details: "Rincian",
    openLogs: "Buka Direktori Log",
    cancel: "Batal",
  },
  update: {
    title: "Pembaruan",
    checking: "Memeriksa...",
    checkNow: "Periksa Pembaruan",
    checkFailed: "Tidak dapat memeriksa pembaruan",
    upToDate: "Versi Anda sudah terbaru.",
    unsupported:
      "Pemeriksaan pembaruan otomatis tidak tersedia di platform ini.",
    available: {
      title: "Pembaruan tersedia",
      description: "Versi {{version}} tersedia di GitHub.",
      download: "Unduh",
      downloading: "Mengunduh...",
      dismiss: "Tutup",
      macosUnsignedNote:
        "Build macOS ini belum ditandatangani secara resmi. Jika macOS memblokir aplikasi, ikuti langkah penandatanganan manual di README GitHub atau issue terkait.",
    },
    downloaded: {
      title: "Pembaruan siap",
      description: "Versi {{version}} telah diunduh.",
      restart: "Mulai Ulang",
    },
  },
  error: {
    generic: "Terjadi kesalahan yang tidak terduga.",
    detailsTitle: "Rincian kesalahan",
    detailsDescription:
      "Rincian kesalahan backend ditampilkan di bawah. Ini dapat mencakup jalur file lokal dan stack frame.",
    keychainUnavailable: "Keychain tidak tersedia.",
    keychainHint: {
      translocation:
        "Terdeteksi App Translocation macOS. Pindahkan aplikasi ke /Applications dan buka kembali.",
      keychainDenied:
        "Akses Keychain ditolak. Aplikasi mungkin belum ditandatangani; lihat README untuk solusi penandatanganan mandiri.",
      signNotarize:
        "Harap gunakan build yang telah ditandatangani dan dinotarisasi jika tersedia.",
    },
    dataMigrationFailed: "Tidak dapat mendekripsi data akun lama.",
    masterKeyUnavailable:
      "Akun tersimpan ditemukan, tetapi kunci enkripsinya saat ini tidak tersedia. Tidak ada data akun atau file kunci yang diubah.",
    dataMigrationHint: {
      relogin: "Silakan masuk kembali atau tambahkan ulang akun Anda.",
      clearData:
        "Jika masalah berlanjut, hapus data akun lokal dan masuk kembali.",
    },
    antigravityStorageJsonNotFound:
      "storage.json Antigravity tidak ditemukan. Buka aplikasi Antigravity target dan masuk sekali, lalu coba beralih lagi.",
    antigravityProjectIdMissing:
      "Akun ini tidak memiliki ID proyek Antigravity. Hal ini dapat terjadi jika akun belum pernah masuk ke aplikasi Antigravity sebelumnya. Silakan masuk sekali di aplikasi Antigravity, lalu kembali ke alat ini dan coba beralih lagi.",
    antigravityDatabasePermissionDenied:
      "Penyimpanan database Antigravity tidak dapat ditulisi. Periksa direktori user-data Antigravity yang dikonfigurasi atau mulai ulang Antigravity Relay setelah membuka Antigravity sekali.",
    cloudAccountLoginExpired:
      "Informasi login untuk akun cloud ini telah kedaluwarsa. Silakan masuk kembali.",
    rootBoundary: {
      title: "Aplikasi Mengalami Kesalahan",
      description:
        "Terjadi kesalahan kritis yang tidak terduga. Anda dapat memuat ulang jendela aplikasi untuk memulihkan operasi normal.",
      reload: "Muat Ulang Aplikasi",
      copyDetails: "Salin Rincian Kesalahan",
      detailsCopied: "Rincian kesalahan berhasil disalin ke papan klip.",
      viewDetails: "Lihat Diagnostik Teknis",
      hideDetails: "Sembunyikan Diagnostik Teknis",
    },
    routeFallback: {
      title: "Gagal Memuat Bagian",
      description:
        "Terjadi kesalahan rendering yang tidak terduga pada tampilan ini.",
      retry: "Coba Lagi Bagian Ini",
      goHome: "Kembali ke Akun",
    },
  },
  nav: {
    accounts: "Akun",
    relay: "Relay & Remote",
    settings: "Pengaturan",
  },
  remote: {
    title: "Koneksi Jarak Jauh & Tethering Seluler",
    subtitle:
      "Server relay Fastify independen dan pengawas tunnel Cloudflare untuk pengawasan seluler tanpa gangguan",
  },
  relay: {
    title: "Server Relay Lokal",
    subtitle: "Jembatan perintah WebSocket lokal dan penyaji PWA statis",
    statusActive: "Aktif",
    statusInactive: "Nonaktif",
    statusStarting: "Memulai...",
    statusStopping: "Menghentikan...",
    port: "Port: {{port}}",
    toggleStart: "Mulai Server Relay",
    toggleStop: "Hentikan Server Relay",
    bufferLabel: "Buffer Perintah",
    bufferCount: "{{count}} perintah dalam antrean",
    bufferEmpty: "Buffer kosong (0 antrean)",
    upstreamTitle: "Jembatan Daemon Upstream",
    upstreamConnected: "Terhubung",
    upstreamReconnecting: "Menghubungkan",
    upstreamBuffering: "Buffering",
    upstreamOffline: "Terputus",
    startFailed: "Gagal memulai server relay: {{error}}",
    stopFailed: "Gagal menghentikan server relay: {{error}}",
    mirrorBoundary: {
      title: "Pemberitahuan Cakupan Remote Mirror",
      badge: "Hanya Desktop & IDE",
      description:
        "Mobile Remote Mirror hanya menayangkan sesi Antigravity IDE dan Aplikasi Desktop Antigravity 2.0. Antigravity CLI (agy) berjalan secara eksklusif di terminal Anda dan tidak dapat ditautkan ke perangkat seluler pendamping.",
      callout:
        "Terminal CLI (agy) berjalan langsung di host ini dan tidak ditayangkan ke perangkat seluler.",
    },
  },
  tunnel: {
    title: "Tunnel Cepat Cloudflare",
    subtitle: "Tunnel HTTPS/WSS publik aman melalui trycloudflare.com",
    statusConnected: "Terhubung",
    statusStarting: "Membangun Tunnel...",
    statusReconnecting: "Menghubungkan Ulang Tunnel...",
    statusStopped: "Berhenti",
    statusError: "Kesalahan Tunnel",
    urlLabel: "URL Tunnel Publik",
    urlPlaceholder: "Menunggu penugasan tunnel...",
    copyUrl: "Salin URL Tunnel",
    urlCopied: "URL tunnel disalin ke papan klip",
    restartTunnel: "Mulai Ulang Tunnel",
    restarting: "Memulai ulang...",
    stop: "Hentikan Tunnel",
    stopping: "Menghentikan...",
    start: "Mulai Tunnel",
    starting: "Memulai...",
    restartFailed: "Gagal memulai ulang tunnel: {{error}}",
    pid: "PID Proses: {{pid}}",
    startFailed: "Gagal memulai tunnel Cloudflare: {{error}}",
    stopFailed: "Gagal menghentikan tunnel Cloudflare: {{error}}",
    notInstalledBadge: "Belum Terpasang",
    missingBannerTitle: "CLI cloudflared Tidak Ditemukan",
    missingBannerDesc:
      "Tunnel Cepat Cloudflare memerlukan file eksekusi cloudflared untuk membangun tunnel publik yang aman bagi kendali jarak jauh seluler.",
    installCommandLabel:
      "Perintah instalasi yang disarankan untuk {{platform}}:",
    installCommandLabelGeneric: "Perintah instalasi:",
    copyCommand: "Salin",
    copied: "Tersalin",
    commandCopied: "Perintah disalin ke papan klip",
    checkAgain: "Periksa Lagi",
    checking: "Memeriksa...",
    binaryDetectedSuccess: "CLI cloudflared ditemukan di {{path}}",
    binaryStillMissing:
      "cloudflared masih belum ditemukan di PATH atau direktori standar",
    officialDocs: "Dokumentasi Resmi",
    startDisabledReason:
      "Tidak dapat memulai tunnel karena file eksekusi cloudflared belum terpasang di sistem ini",
    missingTooltip:
      "File eksekusi cloudflared tidak ditemukan. Silakan pasang untuk mengaktifkan tunnel jarak jauh.",
    binaryNotInstalledTooltip:
      "CLI cloudflared belum terpasang di komputer ini",
  },
  pairing: {
    title: "Pemasangan Seluler & Akses QR",
    subtitle:
      "Pindai dengan kamera ponsel untuk membuka pendamping kendali jarak jauh",
    qrAlt: "Kode QR untuk pemasangan kendali jarak jauh seluler",
    scanInstructions: "Pindai dengan kamera ponsel untuk terhubung",
    scanTip:
      "Pindai kode QR ini dengan kamera perangkat seluler Anda untuk membuka PWA pendamping.",
    securityNotice:
      "URL pemasangan menyertakan kunci otentikasi sekali pakai yang bersifat sementara. Jangan bagikan.",
    regenerateToken: "Buat Ulang Kunci Pemasangan",
    tokenLabel: "Kunci Pemasangan",
    copyToken: "Salin Kunci",
    tokenCopied: "Kunci pemasangan disalin ke papan klip",
    modeTunnel: "Tunnel Cloudflare",
    modeWifi: "Wi-Fi Lokal",
    wifiAdvisory:
      "Hubungkan ponsel ke jaringan Wi-Fi yang sama untuk mengakses.",
    copyLink: "Salin Tautan",
    linkCopied: "Tautan pairing berhasil disalin",
    serverInactive: "Server Relay Nonaktif",
    startServerToPair: "Mulai server relay untuk mengaktifkan pairing ponsel",
    keySingleUseBadge: "Sekali Pakai Per Perangkat",
    autoRegeneratedNotice:
      "Kunci pairing diperbarui otomatis setelah perangkat tersambung",
    keyConsumedError:
      "Kunci pairing ini sudah digunakan oleh perangkat lain. Silakan minta kunci baru dari host desktop.",
    keyInvalidError:
      "Kunci pairing tidak valid. Silakan periksa kunci aktif di dashboard desktop Anda.",
    platformScopeNotice:
      "Pendamping seluler hanya menayangkan sesi Antigravity IDE dan Aplikasi Desktop. Terminal CLI (agy) tidak didukung.",
  },
  sessions: {
    title: "Sesi Ponsel Terhubung",
    subtitle:
      "Koneksi kendali jarak jauh seluler aktif yang diotorisasi melalui relay lokal",
    countSingular: "1 sesi",
    countPlural: "{{count}} sesi",
    countAria: "{{count}} sesi terhubung",
    colDevice: "Perangkat / Klien",
    colIp: "Alamat IP",
    colDuration: "Terhubung Selama",
    colLastActive: "Terakhir Aktif",
    colActions: "Tindakan",
    deviceIdTooltip: "ID Perangkat: {{id}} (klik untuk menyalin)",
    copyDeviceIdAria: "Salin ID perangkat {{id}}",
    deviceIdCopied: "ID perangkat disalin ke papan klip",
    relativeJustNow: "baru saja",
    relativeSecondsAgo: "{{count}} detik lalu",
    relativeMinutesAgo: "{{count}} menit lalu",
    relativeHoursAgo: "{{count}} jam lalu",
    deviceAndroid: "Perangkat Android",
    deviceIPhone: "iPhone",
    deviceIPad: "iPad",
    deviceMac: "Mac",
    deviceWindows: "PC Windows",
    deviceLinux: "PC Linux",
    unknownDevice: "Perangkat Seluler",
    unknownBrowser: "Browser Web",
    revoke: "Cabut",
    revoking: "Mencabut...",
    revokeTooltip: "Hentikan sesi dan putuskan koneksi",
    revokeAriaLabel: "Cabut sesi untuk {{device}} pada {{ip}}",
    confirmRevokeTitle: "Cabut Sesi Seluler?",
    confirmRevokeMessage:
      "Yakin ingin mencabut sesi untuk {{device}} ({{ip}})? Koneksi seluler akan segera diputuskan.",
    confirmRevokeAction: "Konfirmasi Cabut",
    emptyTitle: "Tidak ada perangkat seluler yang terhubung",
    emptyDescription:
      "Pindai kode QR pemasangan di atas dengan ponsel pintar Anda untuk menautkan sesi pertama.",
    revokedToast: "Sesi untuk {{device}} telah dicabut",
    revokeFailed: "Gagal mencabut sesi: {{error}}",
  },
  revocation: {
    screenHeading: "Akses Dicabut oleh Host",
    screenDescription:
      "Sesi perangkat ini telah dihentikan oleh host desktop. Silakan masukkan kunci pairing yang valid untuk menyambung kembali.",
    overlayBadge: "Terputus oleh Host",
    inputLabel: "Kunci Pairing Baru",
    inputPlaceholder: "Masukkan kunci pairing baru",
    reconnectButton: "Sambungkan Ulang Perangkat",
    reconnecting: "Mengotentikasi...",
    reconnectedSuccess: "Perangkat berhasil tersambung kembali!",
    reconnectButtonAria:
      "Kirim kunci pairing baru untuk menyambungkan kembali perangkat yang dicabut ini",
    staleKeyError:
      "Kunci pairing sebelumnya sudah tidak valid. Masukkan kunci yang baru ditampilkan di dashboard desktop.",
    emptyKeyError: "Silakan masukkan kunci pairing sebelum mengirimkan.",
    rateLimitedError:
      "Terlalu banyak percobaan pairing. Harap tunggu sebentar sebelum mencoba lagi.",
    networkError:
      "Tidak dapat menjangkau server relay. Silakan periksa koneksi jaringan Anda.",
    syncingSiblingTabs:
      "Perangkat berhasil dihubungkan ulang. Menyelaraskan tab yang terbuka...",
    fallbackTitle: "Sesi Dicabut - Antigravity Relay",
    fallbackNotice:
      "Sesi Dicabut: Akses telah dicabut oleh host desktop. Silakan masukkan kunci pairing yang valid untuk menyambung kembali.",
  },
  traySync: {
    switchedTitle: "Akun Dialihkan",
    switchedDescription:
      "Akun aktif dialihkan ke {{email}} melalui baki sistem.",
    switchedAllTitle: "Semua Lingkungan Dialihkan",
    switchedAllDescription:
      "Beralih semua lingkungan ke {{email}} melalui baki sistem.",
    switchedTargetTitle: "Akun Dialihkan",
    switchedTargetDescription:
      "Beralih {{target}} ke {{email}} melalui baki sistem.",
  },
  editionSelection: {
    title: "Pilih Edisi Antigravity Anda",
    description:
      "Pilih versi Antigravity yang Anda gunakan. Ini membantu Relay terhubung ke aplikasi yang benar.",
    edition1x: {
      name: "Antigravity 1.x",
      description:
        "Aplikasi Antigravity asli. Pilih ini jika Anda menggunakan versi lama.",
    },
    edition20: {
      name: "Antigravity IDE",
      description:
        "Antigravity IDE baru (2.0). Pilih ini jika Anda menggunakan versi IDE terbaru.",
    },
    confirm: "Lanjutkan",
  },
  account: {
    current: "Saat ini",
    lastUsed: "Terakhir digunakan {{time}}",
    switchToAntigravity: "Beralih ke Antigravity",
    switchToIde: "Beralih ke Antigravity IDE",
  },
  home: {
    title: "Akun",
    description: "Kelola akun Google Gemini Antigravity Anda.",
    noBackups: {
      title: "Cadangan tidak ditemukan",
      description: "Buat cadangan akun Antigravity saat ini untuk memulai.",
      action: "Cadangkan Akun Saat Ini",
    },
  },
  settings: {
    "weekly-warmup": {
      error: "Pengaturan pemanasan kuota tidak dapat dimuat atau disimpan.",
      retry: "Coba Lagi",
      "cost-notice":
        "Pemanasan menggunakan kuota model nyata dan dapat memakai kredit AI. Penerimaan HTTP tidak menjamin timer mingguan baru.",
      title: "Pemanasan kuota mingguan",
      description:
        "Setelah kuota mingguan yang dipilih diatur ulang, kirim satu permintaan minimal per wadah kuota dan catat siklus yang berhasil.",
      enabled: "Aktifkan pemanasan kuota mingguan",
      groups: "Grup kuota untuk dipanaskan",
      group: { claude: "Grup kuota Claude", gemini: "Grup kuota Gemini" },
    },
    title: "Pengaturan",
    description: "Kelola preferensi aplikasi.",
    general: "Umum",
    connection: "Koneksi",
    models: "Model",
    appearance: {
      title: "Tampilan",
      description: "Sesuaikan tampilan Antigravity Relay pada perangkat Anda.",
    },
    darkMode: "Mode Gelap",
    darkModeDescription:
      "Aktifkan mode gelap untuk kenyamanan melihat di malam hari.",
    language: {
      title: "Bahasa",
      description: "Pilih bahasa yang Anda inginkan.",
      english: "English",
      chinese: "Tionghoa (Sederhana)",
      russian: "Rusia",
      vietnamese: "Vietnam",
      turkish: "Turki",
      french: "Prancis",
      indonesian: "Bahasa Indonesia",
    },
    about: {
      title: "Tentang",
      description: "Informasi aplikasi.",
    },
    cache: {
      title: "Cache Antigravity",
      description:
        "Hapus direktori cache Antigravity yang diketahui untuk mengatasi masalah masuk atau validasi versi.",
      clear: "Hapus Cache Antigravity",
      dialogTitle: "Hapus Cache Antigravity?",
      dialogDescription: "Direktori cache yang ada berikut ini akan dihapus.",
      pathsLabel: "Direktori cache",
      noPaths: "Tidak ada direktori cache Antigravity yang ditemukan.",
      warning:
        "Tutup Antigravity sebelum menghapus cache untuk menghindari file terkunci atau dibuat ulang.",
      cancel: "Batal",
      confirm: "Hapus Cache",
      clearing: "Menghapus...",
      clearedTitle: "Cache berhasil dihapus",
      clearedDescription:
        "{{size}} MB telah dihapus dari direktori cache Antigravity.",
      failedTitle: "Gagal menghapus cache",
      notFoundTitle: "Cache Antigravity tidak ditemukan",
    },
    version: "Versi",
    platform: "Platform",
    license: "Lisensi",
    openLogDir: "Buka",
    toast: {
      saved: {
        title: "Pengaturan disimpan",
        description: "Konfigurasi Anda telah diperbarui.",
      },
      saveFailed: {
        title: "Kesalahan saat menyimpan pengaturan",
      },
    },
    account: {
      title: "Pengaturan Akun",
      description: "Konfigurasikan penyegaran dan sinkronisasi akun otomatis.",
      auto_refresh: "Segarkan Kuota Otomatis",
      auto_refresh_desc: "Segarkan info kuota secara berkala untuk semua akun",
      auto_sync: "Sinkronisasi Otomatis Akun Saat Ini",
      auto_sync_desc: "Sinkronkan informasi akun aktif secara berkala",
      antigravity_executable: "File eksekusi Antigravity",
      antigravity_executable_desc:
        "Jalur opsional untuk menemukan data mode portabel dan meluncurkan Antigravity.",
      antigravity_executable_placeholder:
        "Contoh: C:\\Program Files\\Antigravity\\Antigravity.exe",
      antigravity_args: "Argumen peluncuran Antigravity",
      antigravity_args_desc:
        "Argumen opsional yang diteruskan saat meluncurkan Antigravity, seperti --user-data-dir.",
      antigravity_args_placeholder:
        "Contoh: --user-data-dir D:\\AntigravityProfile",
      detect_antigravity_args: "Deteksi",
    },
    startup: {
      title: "Mulai Otomatis",
      description:
        "Kontrol perilaku peluncuran aplikasi saat sistem dinyalakan.",
      auto_startup: "Mulai bersama sistem",
      auto_startup_desc:
        "Luncurkan saat masuk dan simpan aplikasi di baki sistem",
      start_in_tray: "Mulai di baki sistem",
      start_in_tray_desc:
        "Mulai aplikasi dalam keadaan diminimalkan ke baki sistem",
      macos_hint:
        "macOS memerlukan aplikasi bertanda tangan agar Item Masuk berfungsi. Jika gagal, tandatangani aplikasi atau aktifkan manual di Pengaturan Sistem.",
    },
    notifications: {
      title: "Pemberitahuan",
      description: "Konfigurasikan pemberitahuan desktop untuk peristiwa akun.",
      quotaAlert: "Peringatan Kuota Rendah",
      quotaAlertDesc:
        "Dapatkan pemberitahuan saat kuota model turun di bawah ambang batas yang ditentukan",
      quotaThreshold: "Ambang Batas Peringatan",
      quotaThresholdDesc: "Persentase batas bawah untuk memicu peringatan",
      saveFailed: "Gagal menyimpan pengaturan pemberitahuan",
      thresholdSaveFailed: "Gagal menyimpan pengaturan ambang batas",
      aiCreditsAlert: "Peringatan Kredit AI Rendah",
      aiCreditsAlertDesc:
        "Dapatkan pemberitahuan saat saldo kredit AI berada pada atau di bawah jumlah yang ditentukan",
      aiCreditsThreshold: "Ambang Batas Peringatan Kredit AI",
      aiCreditsThresholdDesc:
        "Jumlah kredit batas bawah untuk memicu peringatan",
      aiCreditsThresholdSaveFailed:
        "Gagal menyimpan pengaturan ambang batas kredit AI",
    },
    proxy: {
      title: "Proksi Upstream",
      description:
        "Konfigurasikan proksi untuk permintaan keluar ke API Google/Gemini.",
      enable: "Aktifkan Proksi Upstream",
      url: "URL Proksi",
      timeout: "Batas Waktu Permintaan (Detik)",
    },
    modelMapping: {
      title: "Pemetaan Model",
      description:
        "Petakan model Claude Code ke model Antigravity. Optimalkan biaya dan kecepatan dengan merutekan permintaan secara cerdas.",
      claudeKeyword: "Model Claude (Kata Kunci)",
      targetGemini: "Model Gemini Target",
      addPlaceholderKey: "mis. op-3",
      addPlaceholderValue: "mis. gemini-3-flash",
      noMappings: "Tidak ada pemetaan khusus yang ditentukan.",
      mapsTo: "Dipetakan ke",
      default: "Default",
      restoreDefaults: "Pulihkan Default",
    },
    modelVisibility: {
      title: "Visibilitas Model",
      description:
        "Atur model mana yang terlihat di kartu akun. Model yang disembunyikan tidak akan muncul di tampilan kuota.",
      searchPlaceholder: "Cari model...",
      showAll: "Tampilkan Semua",
      hideAll: "Sembunyikan Semua",
      reset: "Atur Ulang ke Default",
      save: "Simpan Perubahan",
      noModels: "Model tidak ditemukan",
      modelsShown: "{{visible}} dari {{total}} model terlihat",
      quotaManagement: "Manajemen Kuota",
      hidden: "Tersembunyi",
      noModelsFound: "Model tidak ditemukan",
      totalModels: "Total",
      visibleModels: "Terlihat",
      hiddenModels: "Tersembunyi",
      saving: "Menyimpan...",
    },
    autoSwitchModels: {
      title: "Konfigurasi Model Pengalihan Otomatis",
      description:
        "Konfigurasikan model mana yang memicu pengalihan otomatis saat habis, dan prioritaskan model tertentu saat memilih akun aktif berikutnya.",
      searchPlaceholder: "Cari model...",
      noModels: "Model tidak ditemukan.",
      noModelsFound: "Model tidak ditemukan.",
      includeLabel: "Sertakan",
      priorityLabel: "Prioritas",
      save: "Simpan Konfigurasi",
      saving: "Menyimpan...",
      saved: "Konfigurasi model pengalihan otomatis berhasil disimpan.",
      saveFailed: "Gagal menyimpan konfigurasi model pengalihan otomatis.",
    },
    providerGroupings: {
      title: "Pengelompokan Penyedia",
      description:
        "Kelompokkan model berdasarkan penyedia untuk organisasi yang lebih baik",
      enabled: "Aktifkan Pengelompokan Penyedia",
      models: "{{count}} model",
      avgLabel: "rata-rata",
      resetLabel: "reset",
      overall: "Keseluruhan",
      healthy: "Sehat",
      degraded: "Menurun",
      limited: "Terbatas",
      critical: "Kritis",
    },
    save: "Simpan Pengaturan",
  },
  toast: {
    backupSuccess: {
      title: "Berhasil",
      description: "Cadangan akun berhasil dibuat.",
    },
    backupError: {
      title: "Kesalahan",
      description: "Gagal membuat cadangan: {{error}}",
    },
    switchSuccess: {
      title: "Berhasil",
      description: "Berhasil beralih akun.",
    },
    switchError: {
      title: "Kesalahan",
      description: "Gagal beralih akun: {{error}}",
    },
    deleteSuccess: {
      title: "Berhasil",
      description: "Cadangan akun berhasil dihapus.",
    },
    deleteError: {
      title: "Kesalahan",
      description: "Gagal menghapus cadangan: {{error}}",
    },
  },
  cloud: {
    title: "Akun",
    description: "Kelola kumpulan akun Google Gemini Anda.",
    security: {
      compatibilityMode: {
        title: "Penyimpanan kunci mode kompatibilitas aktif",
        description:
          "Data akun tetap dienkripsi dengan AES-256-GCM, tetapi kunci utama disimpan secara lokal dan tidak dilindungi oleh layanan kredensial sistem operasi.",
      },
    },
    autoSwitch: "Alihkan Otomatis",
    providerGroupings: "Pengelompokan Penyedia",
    addAccount: "Tambah Akun",
    addAccountDisabledTooltip:
      "Kredensial klien OAuth belum dikonfigurasi. Atur ANTIGRAVITY_OAUTH_CLIENT_ID dan ANTIGRAVITY_OAUTH_CLIENT_SECRET untuk mengaktifkan.",
    syncFromIde: "Sinkronkan dari Antigravity",
    syncFromAntigravity: "Sinkronkan dari Antigravity",
    checkQuota: "Periksa Kuota Sekarang",
    polling: "Polling dipicu",
    globalQuota: "Kuota Global",
    layout: {
      auto: "Otomatis",
      twoCol: "2 Kolom",
      threeCol: "3 Kolom",
      list: "Daftar",
      compact: "Ringkas",
    },
    "quota-window": {
      label: "Jendela kuota",
      "five-hours": "Kuota 5 jam",
      "five-hours-short": "5j",
      weekly: "Kuota mingguan",
      "weekly-short": "Minggu",
      "no-weekly-quota": "Tidak ada data kuota mingguan",
      "weekly-summary-unavailable":
        "Layanan upstream tidak mengembalikan ringkasan kuota mingguan.",
      "weekly-bucket-unavailable":
        "Ringkasan kuota tidak berisi wadah mingguan yang dapat dikenali.",
    },
    authDialog: {
      title: "Tambah Akun Google",
      description: "Untuk menambahkan akun, Anda harus mengotorisasi aplikasi.",
      missingCredentialsBanner:
        "Variabel lingkungan OAuth belum dikonfigurasi. Menambahkan akun tidak tersedia.",
      unconfiguredWarning:
        "Variabel lingkungan OAuth belum dikonfigurasi. Menambahkan akun tidak tersedia.",
      clientNotConfiguredBadge: "Belum Dikonfigurasi",
      unconfiguredBadge: "Belum Dikonfigurasi",
      selectedClientNotConfiguredWarning:
        "Klien OAuth yang dipilih belum dikonfigurasi.",
      clientUnconfigured: "Klien OAuth yang dipilih belum dikonfigurasi.",
      oauthClient: "Klien OAuth",
      oauthClientPlaceholder: "Pilih klien OAuth",
      openLogin: "Buka Halaman Masuk",
      authCode: "Kode Otorisasi",
      placeholder: "Tempel kode yang dimulai dengan 4/...",
      instruction:
        "Akan membuka browser default untuk masuk ke Google. Salin kode dari halaman localhost lalu tempel di sini.",
      verify: "Verifikasi & Tambah",
    },
    localImport: {
      trigger: "Pindai Akun Lokal",
      title: "Impor Akun Lokal",
      description:
        "Pindai kredensial Antigravity yang masuk, tinjau akun terverifikasi, lalu konfirmasikan impor.",
      scanning: "Memindai dan memverifikasi akun lokal…",
      importing: "Mengimpor akun yang dikonfirmasi…",
      summary: "Ringkasan pemindaian akun lokal",
      accounts: "Akun",
      accountList: "Daftar akun lokal terdeteksi",
      validationFailures: "Kegagalan verifikasi",
      discoveryFailures: "Kegagalan sumber",
      merged: "Digabungkan",
      noAccounts: "Tidak ada akun lokal terverifikasi yang ditemukan.",
      issues: "Item yang tidak akan diimpor",
      project: "Proyek",
      emailCollision: "{{email}} muncul di {{count}} kredensial berbeda.",
      rescan: "Pindai Ulang",
      cancel: "Batal",
      close: "Tutup",
      confirm: "Impor {{count}} Akun",
      resultTitle: "Impor akun lokal selesai",
      resultDescription:
        "Daftar akun telah diperbarui dengan hasil yang dikonfirmasi.",
      imported: "Diimpor {{count}}",
      skipped: "Dilewati {{count}}",
      failed: "Gagal {{count}}",
      sources: {
        "antigravity-keyring": "Penyimpanan Kredensial Sistem",
        "antigravity-classic-db": "Database Antigravity",
        "antigravity-ide-db": "Database IDE Antigravity",
        "legacy-agent": "Data Agent Lama",
        "antigravity-cli-token": "Antigravity CLI",
      },
      validationErrors: {
        "credential-unavailable": "Kredensial tidak lagi tersedia.",
        "authentication-failed": "Google menolak kredensial ini.",
        "network-failed":
          "Akun tidak dapat diverifikasi karena kesalahan jaringan.",
        "timed-out": "Verifikasi akun kehabisan waktu.",
        "unverified-email": "Email akun Google belum diverifikasi.",
        "invalid-profile": "Google mengembalikan profil akun tidak valid.",
      },
      discoveryErrors: {
        missing: "Sumber kredensial tidak ditemukan.",
        "permission-denied": "Izin untuk membaca sumber kredensial ditolak.",
        locked: "Sumber kredensial terkunci atau sedang sibuk.",
        malformed: "Sumber kredensial berisi data yang rusak.",
        "timed-out": "Membaca sumber kredensial kehabisan waktu.",
        "read-failed": "Sumber kredensial tidak dapat dibaca.",
      },
      importErrors: {
        "credential-unavailable": "Kredensial kedaluwarsa sebelum konfirmasi.",
        "identity-required": "Identitas akun terverifikasi diperlukan.",
        "identity-conflict":
          "Kredensial ini berkonflik dengan identitas akun yang sudah ada.",
        "persistence-failed": "Akun tidak dapat disimpan.",
      },
      errors: {
        "preview-failed": "Pratinjau akun lokal tidak dapat disiapkan.",
        "session-not-found": "Sesi impor tidak ditemukan. Pindai ulang.",
        "session-expired": "Sesi impor telah kedaluwarsa. Pindai ulang.",
        "session-consumed": "Sesi impor ini sudah digunakan. Pindai ulang.",
        "confirmation-failed": "Impor akun lokal tidak dapat diselesaikan.",
        "internal-error": "Permintaan impor akun lokal gagal.",
      },
    },
    target: {
      classic: "Aplikasi Antigravity",
      classicShort: "App",
      ide: "Antigravity IDE",
      ideShort: "IDE",
      cli: "Antigravity CLI",
      cliShort: "CLI",
      agy: "Antigravity CLI",
      agyShort: "CLI",
    },
    switch: {
      targetAll: "Beralih untuk Semua Lingkungan",
      targetAllDesc:
        "Sinkronkan kredensial di seluruh App, IDE, dan CLI dalam satu klik",
      targetAllShort: "Beralih Semua",
      activeAll: "Aktif di Semua",
      activeAllAria: "Aktif di semua lingkungan: App, IDE, dan CLI",
      trigger: "Beralih",
      triggerAria: "Beralih akun aktif untuk {{email}}",
      menuTitle: "Pilih Lingkungan Target",
      switchToTarget: "Beralih untuk {{target}}",
      activeBadge: "Aktif",
      currentlyActiveAria: "{{target}} sedang aktif",
      switching: "Beralih...",
      targetNotInstalled: "{{target}} belum terpasang di sistem ini",
      successAllToast: {
        title: "Semua Lingkungan Dialihkan",
        description: "Berhasil beralih semua lingkungan ke {{email}}.",
      },
      partialFailureToast: {
        title: "Pengalihan Sebagian Selesai",
        description:
          "Beralih {{successCount}} dari {{totalCount}} lingkungan ke {{email}}. Gagal untuk {{failedTargets}}: {{error}}",
      },
      failureAllToast: {
        title: "Gagal Beralih",
        description: "Gagal beralih lingkungan: {{error}}",
      },
      noticeRestarted: "Kredensial diterapkan. Memulai ulang {{target}}.",
      noticeInjectedOnDisk:
        "Kredensial diperbarui pada disk untuk {{target}}. Perubahan berlaku pada peluncuran berikutnya.",
      noticeCliUpdated:
        "Kredensial CLI diperbarui. Siap untuk perintah terminal Anda berikutnya.",
      noticeBatchAllRestarted:
        "Kredensial diterapkan. Lingkungan yang berjalan telah dimulai ulang.",
      noticeBatchAllInjected:
        "Kredensial diperbarui pada disk untuk semua lingkungan. Perubahan berlaku pada peluncuran berikutnya.",
      noticeBatchMixed:
        "Kredensial diperbarui: memulai ulang {{restartedTargets}}, diperbarui pada disk untuk {{injectedTargets}}.",
    },
    card: {
      active: "Aktif",
      use: "Gunakan",
      rateLimited: "Batas Laju Tercapai",
      validationRiskControlled: "Risiko / Batas Laju",
      validationOAuthReauthRequired: "Perlu Otorisasi Ulang OAuth",
      validationRequired: "Perlu Verifikasi",
      completeValidation: "Verifikasi",
      left: "tersisa",
      used: "Digunakan",
      unknown: "Pengguna Tidak Dikenal",
      actions: "Tindakan",
      useAccount: "Gunakan Akun",
      identityProfile: "Profil Identitas",
      refresh: "Segarkan Kuota",
      delete: "Hapus Akun",
      noQuota: "Tidak ada data kuota",
      rateLimitedQuota: "Batas Laju Tercapai",
      liveLimitModelNotSupported: "Model tidak didukung",
      liveLimitModelForbidden: "Model dilarang",
      liveLimitQuotaExhausted: "Kuota habis",
      liveLimitRateLimited: "Batas laju tercapai",
      liveLimitRemaining: "tersisa {{duration}}",
      liveLimitDetectedAgo: "terdeteksi {{duration}} lalu",
      liveLimitActiveTitle:
        "Endpoint upstream langsung sementara tidak tersedia.",
      liveLimitRecentTitle:
        "Endpoint upstream langsung baru-baru ini mengembalikan kesalahan.",
      liveLimitQuotaSnapshot:
        "Snapshot kuota masih dapat menampilkan {{percentage}}%.",
      liveLimitMessage: "Pesan: {{message}}",
      resetPrefix: "reset",
      resetTime: "Waktu reset",
      resetUnknown: "Tidak Diketahui",
      detailedQuota: "Kuota terperinci",
      quotaGroupUnknown: "Grup kuota",
      gemini3Ready: "Gemini 3 Siap",
      groupGoogleGemini: "Google Gemini",
      groupAnthropicClaude: "Anthropic Claude",
      proxy: "Proksi",
      proxyPlaceholder: "mis. http://127.0.0.1:7890",
      proxySaved: "Proksi disimpan",
      noProxy: "Tanpa proksi",
      aiCredits: "Kredit AI",
      aiCreditsValue: "{{amount}} kredit",
      creditsExpiry: "kedaluwarsa {{date}}",
      modelVisibility: "Visibilitas Model",
    },
    identity: {
      title: "Profil Identitas",
      loading: "Memuat...",
      generateAndBind: "Buat dan Tautkan",
      captureAndBind: "Ambil dan Tautkan Saat Ini",
      restoreOriginal: "Pulihkan Garis Dasar",
      openFolder: "Buka Penyimpanan Identitas",
      previewTitle: "Pratinjau Identitas yang Dihasilkan",
      confirm: "Konfirmasi",
      cancel: "Batal",
      close: "Tutup",
      currentStorage: "Identitas Runtime Saat Ini",
      accountBinding: "Identitas Akun Tertaut",
      history: "Riwayat Identitas",
      noHistory: "Tidak ada riwayat identitas",
      current: "Aktif",
      restore: "Pulihkan",
      generateSuccess: "Identitas dibuat dan ditautkan",
      captureSuccess: "Identitas saat ini diambil dan ditautkan",
      restoreOriginalSuccess: "Identitas garis dasar dipulihkan",
      restoreVersionSuccess: "Identitas riwayat dipulihkan",
      deleteVersionSuccess: "Identitas riwayat dihapus",
      openFolderSuccess: "Penyimpanan identitas dibuka",
      baseline: "Identitas Garis Dasar",
    },
    list: {
      noAccounts: "Belum ada akun cloud yang ditambahkan.",
      noFilteredAccounts: "Tidak ada akun yang cocok dengan tier yang dipilih.",
    },
    error: {
      loadFailed: "Gagal memuat akun cloud.",
      dataRepair: {
        title: "Data akun terenkripsi memerlukan perbaikan",
        description:
          "Aplikasi tidak dapat mendekripsi data akun lokal. Ini biasanya berarti data dibuat dengan kunci enkripsi yang berbeda atau data lokal rusak.",
        stepReLogin:
          "Jika pemulihan kunci tetap gagal, masuk kembali atau tambahkan ulang akun yang terpengaruh tanpa menghapus database yang ada.",
        stepMacPrivacy:
          "Pada macOS, periksa dialog Keychain/privasi. Jika aplikasi belum ditandatangani atau ditandatangani ulang, tanda tangani lagi, pindahkan ke /Applications, lalu buka kembali.",
        stepCheckGithub:
          "Periksa README repositori GitHub untuk langkah pemecahan masalah terbaru.",
        stepOpenIssue:
          "Cari kesalahan ini di GitHub Issues sebelum menghapus data akun lokal.",
        openRepository: "Buka Repositori GitHub",
        openIssues: "Buka GitHub Issues",
      },
    },
    toast: {
      syncSuccess: {
        title: "Sinkronisasi Berhasil",
        description: "Mengimpor {{email}} dari Antigravity.",
      },
      syncFailed: {
        title: "Sinkronisasi Gagal",
        description: "Tidak ada akun aktif yang ditemukan di Antigravity.",
      },
      addSuccess: "Akun berhasil ditambahkan!",
      addFailed: {
        title: "Gagal menambahkan akun",
      },
      quotaRefreshed: "Kuota disegarkan",
      refreshFailed: "Gagal menyegarkan kuota",
      pollFailed: "Gagal memindai kuota untuk semua akun",
      switched: {
        title: "Akun dialihkan!",
        description: "Memulai ulang Antigravity...",
      },
      switchFailed: "Gagal mengalihkan akun",
      deleted: "Akun dihapus",
      deleteFailed: "Gagal menghapus akun",
      deleteConfirm: "Apakah Anda yakin ingin menghapus akun ini?",
      autoSwitchOn: "Pengalihan Otomatis Diaktifkan",
      autoSwitchOff: "Pengalihan Otomatis Dinonaktifkan",
      updateSettingsFailed: "Gagal memperbarui pengaturan",
      actionFailed: "Tindakan gagal",
      startAuthFailed: "Gagal memulai alur masuk",
      refreshCreditsAvailable: "Kredit AI: {{amount}}",
      refreshCreditsUnavailable:
        "Kredit AI tidak tersedia untuk penyegaran ini.",
      batchRefreshSuccess: "Berhasil menyegarkan {{count}} akun.",
      batchRefreshPartial: {
        title: "Penyegaran selesai dengan masalah",
        description: "Menyegarkan {{successful}} akun, {{failed}} gagal.",
      },
      batchDeleteSuccess: "Berhasil menghapus {{count}} akun.",
      batchDeletePartial: {
        title: "Penghapusan selesai dengan masalah",
        description: "Menghapus {{successful}} akun, {{failed}} gagal.",
      },
    },
    batch: {
      selected: "Dipilih {{count}}",
      delete: "Hapus yang Dipilih",
      refresh: "Segarkan yang Dipilih",
      selectAll: "Pilih Semua",
      clear: "Bersihkan Pilihan",
      confirmDelete: "Apakah Anda yakin ingin menghapus {{count}} akun?",
    },
    tierFilter: {
      all: "Semua tier",
      reset: "Atur ulang ke semua",
      selectedCount: "{{count}} tier",
      unknown: "Tidak Diketahui",
    },
    sort: {
      recentlyUsed: "Baru Digunakan",
      quotaOverall: "Kuota Keseluruhan",
      quotaClaude: "Kuota Claude",
      quotaPro3: "Kuota Pro3",
      quotaFlash: "Kuota Flash",
    },
    exportImport: {
      export: "Ekspor",
      import: "Impor",
      exportTitle: "Ekspor Akun",
      exportDesc:
        "Pilih apakah akan menyertakan token otentikasi dalam file ekspor.",
      includeTokens: "Sertakan token (kurang aman)",
      stripTokens: "Hapus token (lebih aman untuk dibagikan)",
      exportSuccess: "Akun berhasil diekspor",
      importTitle: "Impor Akun",
      importDesc: "Pilih file JSON yang diekspor sebelumnya.",
      importStrategy: "Strategi Impor",
      strategyMerge: "Gabungkan - Perbarui yang ada, tambah baru",
      strategyOverwrite: "Timpa - Ganti semua data yang ada",
      strategySkip: "Lewati - Hanya tambahkan akun baru",
      importSuccess:
        "Diimpor {{imported}}, diperbarui {{updated}}, dilewati {{skipped}}",
      importErrors: "Impor selesai dengan {{count}} kesalahan",
      selectFile: "Pilih File",
      importing: "Mengimpor...",
      fileTooLarge: "Ukuran file melebihi batas 5MB",
      invalidJson: "Format file JSON tidak valid",
      readFileFailed: "Gagal membaca file",
    },
  },
} as const;

export default id;
