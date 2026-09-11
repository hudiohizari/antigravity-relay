const ru = {
  appName: "Antigravity Relay",
  common: {
    loading: "Загрузка...",
    error: "Ошибка",
    unknown: "Неизвестно",
    notAvailable: "Н/Д",
    openMenu: "Открыть меню",
    cancel: "Отмена",
  },
  status: {
    checking: "Проверка статуса...",
    running: "Antigravity работает в фоне",
    stopped: "Служба Antigravity остановлена",
    services: "Службы",
    apps: "Приложения",
    antigravity: "Среда Antigravity",
    relay: "Relay-сервер",
    tunnel: "Туннель Cloudflare",
    dashboard_title: "Статус служб",
    open_dashboard: "Открыть статус служб",
    checking_short: "Проверка...",
    running_short: "Работает",
    stopped_short: "Остановлено",
    all_running: "Все службы работают",
    all_stopped: "Все службы остановлены",
    partial_running: "Работает служб: {{running}}/{{total}}",
    not_installed_short: "Не установлен",
    tunnel_not_installed_tooltip:
      "CLI cloudflared не установлен на этом компьютере",
    wifi_network: "Wi-Fi",
    local_network: "Локальный",
    service_relay: "Сервер Relay",
    service_tunnel: "Туннель Cloudflare",
    service_app: "Antigravity App",
    service_ide: "Antigravity IDE",
    service_cli: "Antigravity CLI",
    tooltips: {
      appNotInstalled: "Приложение Antigravity не обнаружено в этой системе",
      ideNotInstalled: "Antigravity IDE не обнаружен в этой системе",
      cliNotInstalled:
        "Исполняемый файл Antigravity CLI не найден в PATH или стандартных каталогах",
      tunnelNotInstalled: "CLI cloudflared не установлен на этом компьютере",
      cliIdleGuidance: "Запускайте напрямую из терминала через 'agy <команда>'",
    },
  },
  action: {
    stop: "Стоп",
    start: "Старт",
    switch: "Переключить",
    deleteBackup: "Удалить резервную копию",
    backupCurrent: "Создать бэкап текущего",
    retry: "Повторить",
    details: "Подробности",
    openLogs: "Открыть папку логов",
    cancel: "Отмена",
  },
  update: {
    title: "Обновления",
    checking: "Проверка...",
    checkNow: "Проверить обновления",
    checkFailed: "Не удалось проверить обновления",
    upToDate: "У вас последняя версия.",
    unsupported: "Проверка обновлений недоступна на этой платформе.",
    available: {
      title: "Доступно обновление",
      description: "Версия {{version}} доступна на GitHub.",
      download: "Скачать",
      downloading: "Скачивание...",
      dismiss: "Закрыть",
      macosUnsignedNote:
        "Эта сборка macOS официально не подписана. Если macOS блокирует приложение, следуйте шагам ручной подписи в GitHub README или связанных issues.",
    },
    downloaded: {
      title: "Обновление готово",
      description: "Версия {{version}} загружена.",
      restart: "Перезапустить",
    },
  },
  error: {
    generic: "Произошла непредвиденная ошибка.",
    detailsTitle: "Детали ошибки",
    detailsDescription:
      "Ниже показаны детали ошибки backend. Они могут содержать локальные пути и стек вызовов.",
    keychainUnavailable: "Keychain недоступен.",
    keychainHint: {
      translocation:
        "Обнаружено App Translocation (macOS). Переместите приложение в /Applications и откройте заново.",
      keychainDenied:
        "Доступ к Keychain запрещен. Возможно, приложение не подписано. См. README для инструкции.",
      signNotarize: "Пожалуйста, используйте подписанную версию приложения.",
    },
    dataMigrationFailed: "Не удалось расшифровать данные старого аккаунта.",
    masterKeyUnavailable:
      "Сохраненные аккаунты найдены, но ключ шифрования сейчас недоступен. Данные аккаунтов и файлы ключей не изменялись.",
    dataMigrationHint: {
      relogin: "Пожалуйста, перезайдите в аккаунт или добавьте его заново.",
      clearData:
        "Если ошибка сохраняется, очистите локальные данные и войдите снова.",
    },
    antigravityStorageJsonNotFound:
      "Файл Antigravity storage.json не найден. Откройте целевое приложение Antigravity и войдите один раз, затем повторите переключение.",
    antigravityProjectIdMissing:
      "У этого аккаунта отсутствует Antigravity project ID. Это может произойти, если аккаунт раньше не входил в приложение Antigravity. Войдите один раз в приложении Antigravity, затем вернитесь в этот инструмент и повторите переключение.",
    antigravityDatabasePermissionDenied:
      "Хранилище базы данных Antigravity недоступно для записи. Проверьте настроенный каталог Antigravity user-data или перезапустите Antigravity Relay после однократного открытия Antigravity.",
    cloudAccountLoginExpired:
      "Данные входа для этого облачного аккаунта устарели. Пожалуйста, войдите снова.",
    rootBoundary: {
      title: "В приложении произошла ошибка",
      description:
        "Произошла критическая непредвиденная ошибка. Вы можете перезагрузить окно приложения для восстановления нормальной работы.",
      reload: "Перезагрузить приложение",
      copyDetails: "Копировать сведения об ошибке",
      detailsCopied: "Сведения об ошибке скопированы в буфер обмена.",
      viewDetails: "Показать техническую диагностику",
      hideDetails: "Скрыть техническую диагностику",
    },
    routeFallback: {
      title: "Не удалось загрузить раздел",
      description:
        "В этом представлении произошла непредвиденная ошибка отображения.",
      retry: "Повторить попытку",
      goHome: "Вернуться к аккаунтам",
    },
  },
  nav: {
    accounts: "Аккаунты",
    relay: "Relay и удаленный доступ",
    settings: "Настройки",
  },
  remote: {
    title: "Удаленное управление и мобильный доступ",
    subtitle:
      "Автономный Fastify relay-сервер и супервизор туннеля Cloudflare для непрерывного мобильного контроля",
  },
  relay: {
    title: "Локальный Relay-сервер",
    subtitle: "Локальный мост команд WebSocket и статический хостинг PWA",
    statusActive: "Активен",
    statusInactive: "Неактивен",
    statusStarting: "Запуск...",
    statusStopping: "Остановка...",
    port: "Порт: {{port}}",
    toggleStart: "Запустить Relay-сервер",
    toggleStop: "Остановить Relay-сервер",
    bufferLabel: "Буфер команд",
    bufferCount: "{{count}} команд в очереди",
    bufferEmpty: "Буфер пуст (0 в очереди)",
    upstreamTitle: "Мост вышестоящего демона",
    upstreamConnected: "Подключено",
    upstreamReconnecting: "Переподключение",
    upstreamBuffering: "Буферизация",
    upstreamOffline: "Офлайн",
    startFailed: "Не удалось запустить relay-сервер: {{error}}",
    stopFailed: "Не удалось остановить relay-сервер: {{error}}",
    mirrorBoundary: {
      title: "Уведомление об области действия Remote Mirror",
      badge: "Только App и IDE",
      description:
        "Mobile Remote Mirror транслирует только сеансы Antigravity App и Antigravity IDE. Antigravity CLI работает исключительно в терминале и не может отображаться на мобильных устройствах.",
      callout:
        "Antigravity CLI работает непосредственно на этом хосте и не транслируется на мобильные устройства.",
    },
  },
  tunnel: {
    title: "Быстрый туннель Cloudflare",
    subtitle: "Безопасный публичный HTTPS/WSS туннель через trycloudflare.com",
    statusConnected: "Подключено",
    statusStarting: "Установка туннеля...",
    statusReconnecting: "Переподключение туннеля...",
    statusStopped: "Остановлен",
    statusError: "Ошибка туннеля",
    urlLabel: "Публичный URL туннеля",
    urlPlaceholder: "Ожидание назначения туннеля...",
    copyUrl: "Скопировать URL туннеля",
    urlCopied: "URL туннеля скопирован в буфер обмена",
    restartTunnel: "Перезапустить туннель",
    restarting: "Перезапуск...",
    stop: "Остановить туннель",
    stopping: "Остановка...",
    start: "Запустить туннель",
    starting: "Запуск...",
    restartFailed: "Не удалось перезапустить туннель: {{error}}",
    pid: "PID процесса: {{pid}}",
    startFailed: "Не удалось запустить туннель Cloudflare: {{error}}",
    stopFailed: "Не удалось остановить туннель Cloudflare: {{error}}",
    notInstalledBadge: "Не установлен",
    missingBannerTitle: "CLI cloudflared не найден",
    missingBannerDesc:
      "Для быстрого туннеля Cloudflare требуется исполняемый файл cloudflared для создания безопасных публичных туннелей для удаленного доступа с мобильных устройств.",
    installCommandLabel: "Рекомендуемая команда установки для {{platform}}:",
    installCommandLabelGeneric: "Команда установки:",
    copyCommand: "Копировать",
    copied: "Скопировано",
    commandCopied: "Команда скопирована в буфер обмена",
    checkAgain: "Проверить снова",
    checking: "Проверка...",
    binaryDetectedSuccess: "CLI cloudflared найден по пути {{path}}",
    binaryStillMissing:
      "cloudflared по-прежнему не найден в PATH или стандартных каталогах",
    officialDocs: "Официальная документация",
    startDisabledReason:
      "Невозможно запустить туннель, так как исполняемый файл cloudflared не установлен в системе",
    missingTooltip:
      "Исполняемый файл cloudflared отсутствует. Установите его для включения удаленного туннеля.",
    binaryNotInstalledTooltip:
      "CLI cloudflared не установлен на этом компьютере",
  },
  pairing: {
    title: "Сопряжение с телефоном и доступ по QR",
    subtitle:
      "Отсканируйте камерой телефона, чтобы открыть мобильный пульт управления",
    qrAlt: "QR-код для сопряжения мобильного пульта управления",
    scanInstructions: "Отсканируйте камерой телефона для подключения",
    scanTip:
      "Отсканируйте этот QR-код камерой мобильного устройства, чтобы открыть приложение PWA.",
    securityNotice:
      "URL сопряжения содержит одноразовый временный ключ аутентификации. Не передавайте его другим.",
    regenerateToken: "Создать новый ключ сопряжения",
    tokenLabel: "Ключ сопряжения",
    copyToken: "Скопировать ключ",
    tokenCopied: "Ключ сопряжения скопирован в буфер обмена",
    modeTunnel: "Туннель Cloudflare",
    modeWifi: "Локальный Wi-Fi",
    wifiAdvisory: "Для доступа подключите телефон к той же сети Wi-Fi.",
    copyLink: "Скопировать ссылку",
    linkCopied: "Ссылка для сопряжения скопирована в буфер обмена",
    serverInactive: "Relay-сервер неактивен",
    startServerToPair:
      "Запустите relay-сервер, чтобы включить сопряжение с телефоном",
    keySingleUseBadge: "Одноразовый для устройства",
    autoRegeneratedNotice:
      "Ключ сопряжения автоматически обновлен после подключения устройства",
    keyConsumedError:
      "Этот ключ сопряжения уже был использован другим устройством. Получите новый ключ на desktop-хосте.",
    keyInvalidError:
      "Недействительный ключ сопряжения. Проверьте активный ключ на панели управления desktop.",
    platformScopeNotice:
      "Мобильный компаньон транслирует только сеансы Antigravity App и Antigravity IDE. Antigravity CLI не поддерживается.",
  },
  sessions: {
    title: "Подключенные сессии телефонов",
    subtitle:
      "Активные сессии мобильного удаленного управления, авторизованные через локальный relay",
    countSingular: "1 сессия",
    countPlural: "{{count}} сессий",
    countAria: "{{count}} подключенных сессий",
    colDevice: "Устройство / Клиент",
    colIp: "IP-адрес",
    colDuration: "Подключено",
    colLastActive: "Последняя активность",
    colActions: "Действия",
    deviceIdTooltip: "ID устройства: {{id}} (нажмите для копирования)",
    copyDeviceIdAria: "Скопировать ID устройства {{id}}",
    deviceIdCopied: "ID устройства скопирован в буфер обмена",
    relativeJustNow: "только что",
    relativeSecondsAgo: "{{count}} сек. назад",
    relativeMinutesAgo: "{{count}} мин. назад",
    relativeHoursAgo: "{{count}} ч. назад",
    deviceAndroid: "Устройство Android",
    deviceIPhone: "iPhone",
    deviceIPad: "iPad",
    deviceMac: "Mac",
    deviceWindows: "ПК с Windows",
    deviceLinux: "ПК с Linux",
    unknownDevice: "Мобильное устройство",
    unknownBrowser: "Веб-браузер",
    revoke: "Отозвать",
    revoking: "Отзыв...",
    revokeTooltip: "Завершить сессию и разорвать соединение",
    revokeAriaLabel: "Отозвать сессию для {{device}} на {{ip}}",
    confirmRevokeTitle: "Отозвать сессию телефона?",
    confirmRevokeMessage:
      "Вы уверены, что хотите отозвать сессию для {{device}} ({{ip}})? Мобильное соединение будет немедленно разорвано.",
    confirmRevokeAction: "Подтвердить отзыв",
    emptyTitle: "Нет подключенных мобильных устройств",
    emptyDescription:
      "Отсканируйте QR-код выше своим смартфоном, чтобы подключить первую удаленную сессию.",
    revokedToast: "Сессия для {{device}} отозвана",
    revokeFailed: "Не удалось отозвать сессию: {{error}}",
  },
  revocation: {
    screenHeading: "Доступ отозван хостом",
    screenDescription:
      "Сессия этого устройства была завершена desktop-хостом. Введите действительный ключ сопряжения для восстановления соединения.",
    overlayBadge: "Отключено хостом",
    inputLabel: "Новый ключ сопряжения",
    inputPlaceholder: "Введите новый ключ сопряжения",
    reconnectButton: "Повторно подключить устройство",
    reconnecting: "Аутентификация...",
    reconnectedSuccess: "Устройство успешно переподключено!",
    reconnectButtonAria:
      "Отправить новый ключ сопряжения для переподключения отозванного устройства",
    staleKeyError:
      "Предыдущий ключ сопряжения больше не действителен. Введите новый ключ, отображаемый на панели управления desktop.",
    emptyKeyError: "Пожалуйста, введите ключ сопряжения перед отправкой.",
    rateLimitedError:
      "Слишком много попыток сопряжения. Пожалуйста, подождите немного перед повторной попыткой.",
    networkError:
      "Не удалось связаться с relay-сервером. Проверьте сетевое подключение.",
    syncingSiblingTabs:
      "Устройство успешно сопряжено заново. Синхронизация открытых вкладок...",
    fallbackTitle: "Сессия отозвана - Antigravity Relay",
    fallbackNotice:
      "Сессия отозвана: доступ был отозван desktop-хостом. Введите действительный ключ сопряжения для восстановления соединения.",
  },
  traySync: {
    switchedTitle: "Аккаунт переключен",
    switchedDescription:
      "Активный аккаунт переключен на {{email}} через системный трей.",
    switchedAllTitle: "Все среды переключены",
    switchedAllDescription:
      "Все среды переключены на {{email}} через системный трей.",
    switchedTargetTitle: "Аккаунт переключен",
    switchedTargetDescription:
      "Среда {{target}} переключена на {{email}} через системный трей.",
  },
  account: {
    current: "Текущий",
    lastUsed: "Последнее использование {{time}}",
    switchToAntigravity: "Переключиться на Antigravity",
    switchToIde: "Переключиться на Antigravity IDE",
  },
  home: {
    title: "Аккаунты",
    description: "Управление вашими аккаунтами Antigravity Google Gemini.",
    noBackups: {
      title: "Бэкапы не найдены",
      description:
        "Создайте резервную копию вашего текущего аккаунта Antigravity, чтобы начать.",
      action: "Создать бэкап текущего аккаунта",
    },
  },
  settings: {
    "weekly-warmup": {
      error: "Не удалось загрузить или сохранить настройки прогрева.",
      retry: "Повторить",
      "cost-notice":
        "Прогрев расходует квоту модели и может использовать AI credits. Принятие HTTP-запроса не гарантирует запуск недельного таймера.",
      title: "Прогрев недельной квоты",
      description:
        "После сброса выбранной недельной квоты отправляет один минимальный запрос на каждый сегмент и сохраняет успешный цикл.",
      enabled: "Включить прогрев недельной квоты",
      groups: "Группы квот для прогрева",
      group: { claude: "Группы квот Claude", gemini: "Группы квот Gemini" },
    },
    title: "Настройки",
    description: "Управление настройками приложения.",
    general: "Общие",
    connection: "Подключение",
    models: "Модели",
    appearance: {
      title: "Внешний вид",
      description: "Настройте внешний вид Antigravity Relay.",
    },
    darkMode: "Темная тема",
    darkModeDescription: "Включить темную тему для комфортной работы ночью.",
    language: {
      title: "Язык",
      description: "Выберите язык интерфейса.",
      english: "English",
      chinese: "中文 (简体)",
      russian: "Русский",
      vietnamese: "Вьетнамский",
      turkish: "Турецкий",
      french: "Французский",
      indonesian: "Индонезийский",
    },
    about: {
      title: "О программе",
      description: "Информация о приложении.",
    },
    cache: {
      title: "Кэш Antigravity App",
      description:
        "Очистите известные каталоги кэша Antigravity App, чтобы устранить ошибки входа или проверки версии.",
      clear: "Очистить кэш Antigravity App",
      dialogTitle: "Очистить кэш Antigravity App?",
      dialogDescription: "Следующие существующие каталоги кэша будут удалены.",
      pathsLabel: "Каталоги кэша",
      noPaths: "Известные каталоги кэша Antigravity App не найдены.",
      warning:
        "Закройте Antigravity App перед очисткой, чтобы избежать заблокированных файлов.",
      cancel: "Отмена",
      confirm: "Очистить кэш",
      clearing: "Очистка...",
      clearedTitle: "Кэш очищен",
      clearedDescription:
        "Из каталогов кэша Antigravity App удалено {{size}} МБ.",
      failedTitle: "Не удалось очистить кэш",
      notFoundTitle: "Кэш Antigravity App не найден",
    },
    version: "Версия",
    platform: "Платформа",
    license: "Лицензия",
    openLogDir: "Открыть",
    toast: {
      saved: {
        title: "Настройки сохранены",
        description: "Конфигурация обновлена.",
      },
      saveFailed: {
        title: "Ошибка сохранения настроек",
      },
    },
    account: {
      title: "Настройки аккаунта",
      description: "Настройка автоматического обновления и синхронизации.",
      auto_refresh: "Автообновление квот",
      auto_refresh_desc:
        "Периодически обновлять информацию о квотах для всех аккаунтов",
      auto_sync: "Автосинхронизация текущего",
      auto_sync_desc: "Периодически синхронизировать активный аккаунт",
      antigravity_executable: "Файл запуска Antigravity App",
      antigravity_executable_desc:
        "Необязательный путь для поиска данных portable mode и запуска Antigravity App.",
      antigravity_executable_placeholder:
        "Например: C:\\Program Files\\Antigravity\\Antigravity.exe",
      antigravity_args: "Аргументы запуска Antigravity App",
      antigravity_args_desc:
        "Необязательные аргументы запуска Antigravity App, например --user-data-dir.",
      antigravity_args_placeholder:
        "Например: --user-data-dir D:\\AntigravityProfile",
      detect_antigravity_args: "Найти",
    },
    runtimes: {
      title: "Среды выполнения",
      description:
        "Настройка путей к исполняемым файлам и аргументов запуска для сред Antigravity.",
      target_app: "Antigravity App",
      target_ide: "Antigravity IDE",
      target_cli: "Antigravity CLI (agy)",
      browse: "Обзор",
      clear: "Очистить",
      detect: "Найти",
      detecting: "Поиск...",
      auto_detect_all: "Найти все",
      auto_detect_all_aria:
        "Автоматически найти все установленные исполняемые файлы Antigravity",
      detect_exec: "Найти",
      app: {
        title: "Antigravity App",
        executable: "Файл запуска Antigravity App",
        executable_desc:
          "Путь для поиска данных портативного режима и запуска Antigravity App.",
        executable_placeholder:
          "Например: C:\\Program Files\\Antigravity\\Antigravity.exe",
        args: "Аргументы запуска Antigravity App",
        args_desc:
          "Необязательные аргументы запуска Antigravity App, например --user-data-dir.",
        args_placeholder: "Например: --user-data-dir D:\\AntigravityProfile",
        browse_aria: "Выбрать файл запуска Antigravity App",
        clear_path_aria: "Очистить путь к файлу запуска Antigravity App",
        clear_args_aria: "Очистить аргументы запуска Antigravity App",
        detect_args: "Найти",
        detect_args_aria:
          "Найти аргументы запуска из запущенного Antigravity App",
        detect_exec_aria:
          "Найти установленный исполняемый файл Antigravity App",
      },
      ide: {
        title: "Antigravity IDE",
        executable: "Файл запуска Antigravity IDE",
        executable_desc:
          "Путь для поиска и запуска портативной или пользовательской версии Antigravity IDE.",
        executable_placeholder:
          "Например: D:\\Tools\\AntigravityIDE\\AntigravityIDE.exe",
        args: "Аргументы запуска Antigravity IDE",
        args_desc:
          "Необязательные аргументы запуска Antigravity IDE, например каталоги данных или расширений.",
        args_placeholder:
          "Например: --user-data-dir D:\\Tools\\AntigravityIDE\\data",
        browse_aria: "Выбрать файл запуска Antigravity IDE",
        clear_path_aria: "Очистить путь к файлу запуска Antigravity IDE",
        clear_args_aria: "Очистить аргументы запуска Antigravity IDE",
        detect_args: "Найти",
        detect_args_aria:
          "Найти аргументы запуска из запущенного Antigravity IDE",
        detect_exec_aria:
          "Найти установленный исполняемый файл Antigravity IDE",
      },
      cli: {
        title: "Antigravity CLI (agy)",
        executable: "Файл запуска Antigravity CLI (agy)",
        executable_desc:
          "Путь для поиска исполняемого файла agy, если он отсутствует в системном PATH.",
        executable_placeholder:
          "Например: /usr/local/bin/agy или ~/.local/bin/agy",
        browse_aria: "Выбрать файл запуска Antigravity CLI",
        clear_path_aria: "Очистить путь к файлу запуска Antigravity CLI",
        detect_exec_aria:
          "Найти установленный исполняемый файл Antigravity CLI (agy)",
      },
      toast: {
        success_title: "Аргументы обнаружены",
        success_desc:
          "Аргументы запуска успешно обнаружены и применены из запущенного процесса {{target}}.",
        empty_title: "Используются стандартные аргументы",
        empty_desc:
          "{{target}} запущен со стандартными аргументами (дополнительные параметры не найдены).",
        not_running_title: "Процесс не запущен",
        not_running_desc:
          "Запущенный процесс {{target}} не обнаружен. Текущие аргументы сохранены.",
        error_title: "Сбой обнаружения",
        error_desc:
          "Не удалось получить аргументы запущенного процесса для {{target}}.",
        exec_detected_title: "Файл обнаружен",
        exec_detected_desc:
          "Успешно обнаружен и настроен {{target}} по пути {{path}}.",
        exec_not_found_title: "Файл не найден",
        exec_not_found_desc:
          "Установленный исполняемый файл {{target}} не найден в вашей системе.",
        exec_already_set_title: "Уже настроено",
        exec_already_set_desc:
          "Для {{target}} уже установлен обнаруженный путь.",
        exec_preserved_title: "Путь сохранен",
        exec_preserved_desc:
          "Текущий путь для {{target}} сохранен без изменений.",
        exec_bulk_summary_title: "Поиск завершен",
        exec_bulk_summary_desc: "Настроено исполняемых файлов: {{count}}.",
        exec_bulk_unchanged_desc:
          "Все установленные среды выполнения уже настроены.",
        exec_bulk_none_desc:
          "В этой системе не найдено установленных исполняемых файлов Antigravity.",
      },
      dialog: {
        replace_title: "Заменить путь к файлу?",
        replace_desc:
          "Заменить настроенный путь для {{target}} на обнаруженный путь?",
        batch_title: "Конфликт путей к файлам",
        batch_desc:
          "Обнаруженные пути отличаются от текущих настроек. Выберите пути для замены.",
        current_label: "Текущий путь",
        detected_label: "Обнаруженный путь",
        replace_all: "Заменить все",
        replace_selected: "Заменить выбранные",
        keep_current: "Оставить текущие",
      },
    },
    startup: {
      title: "Автозагрузка",
      description: "Управление запуском приложения при старте системы.",
      auto_startup: "Запускать вместе с системой",
      auto_startup_desc: "Запускать при входе и сворачивать в трей",
      start_in_tray: "Запускать в трее",
      start_in_tray_desc: "Запускать приложение свернутым в системный трей",
      macos_hint:
        "macOS требует подписанное приложение для работы элементов входа. Если автозапуск не работает, подпишите приложение или включите его вручную в системных настройках.",
    },
    notifications: {
      title: "Уведомления",
      description: "Настройте уведомления о событиях аккаунтов.",
      quotaAlert: "Уведомления о низкой квоте",
      quotaAlertDesc:
        "Получайте уведомления, когда квота модели падает ниже установленного порога",
      quotaThreshold: "Порог уведомления",
      quotaThresholdDesc: "Процент, ниже которого срабатывает уведомление",
      saveFailed: "Не удалось сохранить настройки уведомлений",
      thresholdSaveFailed: "Не удалось сохранить порог уведомления",
      aiCreditsAlert: "Уведомление о низком балансе AI-кредитов",
      aiCreditsAlertDesc:
        "Получайте уведомления, когда баланс AI-кредитов достигает или опускается ниже установленного значения",
      aiCreditsThreshold: "Порог уведомления об AI-кредитах",
      aiCreditsThresholdDesc:
        "Количество кредитов, при достижении которого срабатывает уведомление",
      aiCreditsThresholdSaveFailed: "Не удалось сохранить порог AI-кредитов",
    },
    proxy: {
      title: "Верхнеуровневый прокси",
      description:
        "Настроить прокси для исходящих запросов к Google/Gemini API.",
      enable: "Включить прокси",
      url: "URL прокси",
      timeout: "Тайм-аут запроса (сек)",
    },
    modelMapping: {
      title: "Маппинг моделей",
      description:
        "Сопоставьте модели Claude Code с моделями Antigravity. Оптимизируйте затраты и скорость, разумно маршрутизируя запросы.",
      claudeKeyword: "Модель Claude (Ключевое слово)",
      targetGemini: "Целевая модель Gemini",
      addPlaceholderKey: "например, op-3",
      addPlaceholderValue: "например, gemini-3-flash",
      noMappings: "Нет пользовательских сопоставлений.",
      mapsTo: "Мапится в",
      default: "По умолчанию",
      restoreDefaults: "Сбросить по умолчанию",
    },
    modelVisibility: {
      title: "Видимость моделей",
      description:
        "Управляйте тем, какие модели отображаются в карточках аккаунтов. Скрытые модели не будут показаны в отображении квот.",
      searchPlaceholder: "Поиск моделей...",
      showAll: "Показать все",
      hideAll: "Скрыть все",
      reset: "Сбросить по умолчанию",
      save: "Сохранить изменения",
      noModels: "Модели не найдены",
      modelsShown: "{{visible}} из {{total}} моделей видно",
      quotaManagement: "Управление квотами",
      hidden: "Скрыто",
      noModelsFound: "Модели не найдены",
      totalModels: "Всего",
      visibleModels: "Видно",
      hiddenModels: "Скрыто",
      saving: "Сохранение...",
    },
    autoSwitchModels: {
      title: "Настройка автосвапа моделей",
      description:
        "Настройте, какие модели вызывают автосвап при исчерпании лимитов, и какие модели приоритетны при выборе следующего аккаунта.",
      searchPlaceholder: "Поиск моделей...",
      noModels: "Модели не найдены.",
      noModelsFound: "Модели не найдены.",
      includeLabel: "Включить",
      priorityLabel: "Приоритет",
      save: "Сохранить настройки",
      saving: "Сохранение...",
      saved: "Настройки автосвапа успешно сохранены.",
      saveFailed: "Не удалось сохранить настройки автосвапа.",
    },
    providerGroupings: {
      title: "Группировка провайдеров",
      description: "Группировка моделей по провайдерам для лучшей организации",
      enabled: "Включить группировку провайдеров",
      models: "{{count}} моделей",
      avgLabel: "сред.",
      resetLabel: "сброс",
      overall: "Общее",
      healthy: "Исправно",
      degraded: "Снижено",
      limited: "Ограничено",
      critical: "Критично",
    },
    save: "Сохранить настройки",
  },
  toast: {
    backupSuccess: {
      title: "Успешно",
      description: "Бэкап аккаунта создан.",
    },
    backupError: {
      title: "Ошибка",
      description: "Не удалось создать бэкап: {{error}}",
    },
    switchSuccess: {
      title: "Успешно",
      description: "Аккаунт переключен.",
    },
    switchError: {
      title: "Ошибка",
      description: "Не удалось переключить аккаунт: {{error}}",
    },
    deleteSuccess: {
      title: "Успешно",
      description: "Бэкап удален.",
    },
    deleteError: {
      title: "Ошибка",
      description: "Не удалось удалить бэкап: {{error}}",
    },
  },
  cloud: {
    title: "Аккаунты",
    description: "Управление пулом аккаунтов Google Gemini.",
    summary: {
      statusUnified: "Единый режим (1 активен)",
      statusUnifiedSubtitle: "Все среды синхронизированы",
      statusDiverged: "Разделено ({{count}} сред расходятся)",
      statusDivergedSubtitle: "В средах запущены разные аккаунты",
    },
    divergedBanner: {
      title: "Рассинхронизация сред",
      description: "В средах используются разные аккаунты: {{targets}}",
      strandedWarning:
        "Среда {{target}} осталась на аккаунте с исчерпанным лимитом.",
      resyncAction: "Синхронизировать все среды с {{email}}",
      resyncActionDefault: "Синхронизировать все среды",
      resyncing: "Синхронизация...",
    },
    security: {
      compatibilityMode: {
        title: "Используется совместимое хранилище ключа",
        description:
          "Данные аккаунтов по-прежнему зашифрованы с помощью AES-256-GCM, но мастер-ключ хранится локально и не защищен системной службой учетных данных.",
      },
    },
    autoSwitch: "Авто-переключение",
    providerGroupings: "Группировка по провайдерам",
    addAccount: "Добавить аккаунт",
    addAccountDisabledTooltip:
      "Учетные данные клиента OAuth не настроены. Установите ANTIGRAVITY_OAUTH_CLIENT_ID и ANTIGRAVITY_OAUTH_CLIENT_SECRET для включения.",
    syncFromIde: "Синхр. из Antigravity",
    syncFromAntigravity: "Синхр. из Antigravity",
    checkQuota: "Проверить квоту",
    polling: "Опрос запущен",
    globalQuota: "Глобальная квота",
    layout: {
      auto: "Авто",
      twoCol: "2 колонки",
      threeCol: "3 колонки",
      list: "Список",
      compact: "Компактный",
    },
    "quota-window": {
      label: "Период квоты",
      "five-hours": "Квота на 5 часов",
      "five-hours-short": "5 ч",
      weekly: "Недельная квота",
      "weekly-short": "Неделя",
      "no-weekly-quota": "Нет данных о недельной квоте",
      "weekly-summary-unavailable":
        "Внешний сервис не вернул сводку недельной квоты.",
      "weekly-bucket-unavailable":
        "В сводке квоты нет распознаваемого недельного лимита.",
    },
    authDialog: {
      title: "Добавить Google Аккаунт",
      description:
        "Для добавления аккаунта необходимо авторизовать приложение.",
      missingCredentialsBanner:
        "Переменные окружения OAuth не настроены. Добавление аккаунтов недоступно.",
      unconfiguredWarning:
        "Переменные окружения OAuth не настроены. Добавление аккаунтов недоступно.",
      clientNotConfiguredBadge: "Не настроен",
      unconfiguredBadge: "Не настроен",
      selectedClientNotConfiguredWarning: "Выбранный клиент OAuth не настроен.",
      clientUnconfigured: "Выбранный клиент OAuth не настроен.",
      oauthClient: "OAuth клиент",
      oauthClientPlaceholder: "Выберите OAuth клиент",
      openLogin: "Открыть страницу входа",
      authCode: "Код авторизации",
      placeholder: "Вставьте код, начинающийся с 4/...",
      instruction:
        "Откроется браузер для входа в Google. Скопируйте код со страницы localhost и вставьте сюда.",
      verify: "Проверить и добавить",
    },
    localImport: {
      trigger: "Сканировать локальные аккаунты",
      title: "Импорт локальных аккаунтов",
      description:
        "Сканирование учетных записей Antigravity, проверка найденных аккаунтов и подтверждение импорта.",
      scanning: "Сканирование и проверка локальных аккаунтов…",
      importing: "Импорт подтвержденных аккаунтов…",
      summary: "Сводка сканирования локальных аккаунтов",
      accounts: "Аккаунты",
      accountList: "Обнаруженные локальные аккаунты",
      validationFailures: "Ошибки проверки",
      discoveryFailures: "Ошибки источников",
      merged: "Объединено",
      noAccounts: "Проверенных локальных аккаунтов не найдено.",
      issues: "Элементы, которые не будут импортированы",
      project: "Проект",
      emailCollision: "{{email}} встречается в {{count}} разных источниках.",
      rescan: "Сканировать снова",
      cancel: "Отмена",
      close: "Закрыть",
      confirm: "Импортировать {{count}} аккаунтов",
      resultTitle: "Импорт локальных аккаунтов завершен",
      resultDescription:
        "Список аккаунтов обновлен с подтвержденным результатом.",
      imported: "Импортировано: {{count}}",
      skipped: "Пропущено: {{count}}",
      failed: "С ошибкой: {{count}}",
      sources: {
        "antigravity-keyring": "Системное хранилище ключей",
        "antigravity-app-db": "База данных Antigravity App",
        "antigravity-classic-db": "База данных Antigravity App",
        "antigravity-ide-db": "База данных Antigravity IDE",
        "legacy-agent": "Данные старого агента",
        "antigravity-cli-token": "Antigravity CLI",
      },
      validationErrors: {
        "credential-unavailable": "Учетные данные больше недоступны.",
        "authentication-failed": "Google отклонил эти учетные данные.",
        "network-failed": "Не удалось проверить аккаунт из-за сетевой ошибки.",
        "timed-out": "Время проверки аккаунта истекло.",
        "unverified-email": "Email аккаунта Google не подтвержден.",
        "invalid-profile": "Google вернул недопустимый профиль аккаунта.",
      },
      discoveryErrors: {
        missing: "Источник учетных данных не найден.",
        "permission-denied": "В доступе к источнику учетных данных отказано.",
        locked: "Источник учетных данных заблокирован или занят.",
        malformed: "Источник учетных данных содержит поврежденные данные.",
        "timed-out": "Время чтения источника учетных данных истекло.",
        "read-failed": "Не удалось прочитать источник учетных данных.",
      },
      importErrors: {
        "credential-unavailable":
          "Срок действия учетных данных истек до подтверждения.",
        "identity-required": "Требуется проверенный идентификатор аккаунта.",
        "identity-conflict":
          "Эти учетные данные конфликтуют с существующим аккаунтом.",
        "persistence-failed": "Не удалось сохранить аккаунт.",
      },
      errors: {
        "preview-failed":
          "Не удалось подготовить предварительный просмотр локальных аккаунтов.",
        "session-not-found":
          "Сессия импорта не найдена. Повторите сканирование.",
        "session-expired": "Сессия импорта истекла. Повторите сканирование.",
        "session-consumed":
          "Эта сессия импорта уже была использована. Повторите сканирование.",
        "confirmation-failed":
          "Не удалось завершить импорт локальных аккаунтов.",
        "internal-error": "Запрос на импорт локальных аккаунтов не удался.",
      },
    },
    target: {
      app: "Приложение Antigravity",
      appShort: "Приложение",
      classic: "Приложение Antigravity",
      classicShort: "Приложение",
      ide: "Antigravity IDE",
      ideShort: "IDE",
      cli: "Antigravity CLI",
      cliShort: "CLI",
      agy: "Antigravity CLI",
      agyShort: "CLI",
    },
    switch: {
      targetAll: "Переключить для всех сред",
      targetAllDesc:
        "Синхронизируйте учетные данные в приложении, IDE и CLI в один клик",
      targetAllShort: "Переключить все",
      activeAll: "Активен везде",
      activeAllAria: "Активен во всех средах: приложении, IDE и CLI",
      trigger: "Переключить",
      triggerAria: "Переключить активный аккаунт для {{email}}",
      menuTitle: "Выберите целевую среду",
      switchToTarget: "Переключить для {{target}}",
      activeBadge: "Активен",
      currentlyActiveAria: "{{target}} в настоящее время активен",
      switching: "Переключение...",
      targetNotInstalled: "{{target}} не установлен в этой системе",
      cliHint: "Терминальная утилита: применяется к новым сессиям",
      successAllToast: {
        title: "Все среды переключены",
        description: "Все среды успешно переключены на {{email}}.",
      },
      partialFailureToast: {
        title: "Частичное переключение завершено",
        description:
          "Переключено {{successCount}} из {{totalCount}} сред на {{email}}. Ошибка для {{failedTargets}}: {{error}}",
      },
      failureAllToast: {
        title: "Ошибка переключения",
        description: "Не удалось переключить среды: {{error}}",
      },
      noticeRestarted:
        "Учетные данные применены. Среда {{target}} перезапущена.",
      noticeInjectedOnDisk:
        "Учетные данные записаны на диск для {{target}}. Изменения вступят в силу при следующем запуске.",
      noticeCliUpdated:
        "Учетные данные CLI обновлены. Готово к следующей команде терминала.",
      noticeBatchAllRestarted:
        "Учетные данные применены. Запущенные среды перезапущены.",
      noticeBatchAllInjected:
        "Учетные данные записаны на диск для всех сред. Изменения вступят в силу при следующем запуске.",
      noticeBatchMixed:
        "Учетные данные обновлены: перезапущены {{restartedTargets}}, записаны на диск для {{injectedTargets}}.",
    },
    card: {
      active: "Активен",
      use: "Использовать",
      rateLimited: "Лимит исчерпан",
      validationRiskControlled: "Риск / Ограничение",
      validationOAuthReauthRequired: "Требуется повторный OAuth",
      validationRequired: "Требуется проверка",
      completeValidation: "Пройти проверку",
      left: "ост.",
      used: "Исп.",
      unknown: "Неизвестный",
      actions: "Действия",
      useAccount: "Использовать этот аккаунт",
      identityProfile: "Профиль идентичности",
      refresh: "Обновить квоту",
      delete: "Удалить аккаунт",
      noQuota: "Нет данных",
      rateLimitedQuota: "Лимит исчерпан",
      liveLimitModelNotSupported: "Модель не поддерживается",
      liveLimitModelForbidden: "Доступ к модели запрещён",
      liveLimitQuotaExhausted: "Квота исчерпана",
      liveLimitRateLimited: "Ограничение частоты",
      liveLimitRemaining: "осталось {{duration}}",
      liveLimitDetectedAgo: "обнаружено {{duration}} назад",
      liveLimitActiveTitle: "Рабочая конечная точка временно недоступна.",
      liveLimitRecentTitle: "Рабочая конечная точка недавно вернула ошибку.",
      liveLimitQuotaSnapshot:
        "Снимок квоты всё ещё может показывать {{percentage}}%.",
      liveLimitMessage: "Сообщение: {{message}}",
      resetPrefix: "Сброс",
      resetTime: "Время сброса",
      resetUnknown: "Неизвестно",
      detailedQuota: "Подробная квота",
      quotaGroupUnknown: "Группа квот",
      gemini3Ready: "Gemini 3 готов",
      groupGoogleGemini: "Google Gemini",
      groupAnthropicClaude: "Anthropic Claude",
      proxy: "Прокси",
      proxyPlaceholder: "напр. http://127.0.0.1:7890",
      proxySaved: "Прокси сохранён",
      noProxy: "Без прокси",
      aiCredits: "AI Кредиты",
      aiCreditsValue: "{{amount}} кредитов",
      creditsExpiry: "истекает {{date}}",
      modelVisibility: "Видимость моделей",
    },
    identity: {
      title: "Профиль идентичности",
      loading: "Загрузка...",
      generateAndBind: "Создать и привязать",
      captureAndBind: "Считать текущий и привязать",
      restoreOriginal: "Восстановить базовый профиль",
      openFolder: "Открыть хранилище профилей",
      previewTitle: "Предпросмотр сгенерированного профиля",
      confirm: "Подтвердить",
      cancel: "Отмена",
      close: "Закрыть",
      currentStorage: "Текущий профиль окружения",
      accountBinding: "Профиль, привязанный к аккаунту",
      history: "История профилей",
      noHistory: "История профилей пуста",
      current: "Активный",
      restore: "Восстановить",
      generateSuccess: "Профиль создан и привязан",
      captureSuccess: "Текущий профиль считан и привязан",
      restoreOriginalSuccess: "Базовый профиль восстановлен",
      restoreVersionSuccess: "Исторический профиль восстановлен",
      deleteVersionSuccess: "Исторический профиль удален",
      openFolderSuccess: "Хранилище профилей открыто",
      baseline: "Базовый профиль",
    },
    list: {
      noAccounts: "Нет добавленных облачных аккаунтов.",
      noFilteredAccounts: "Нет аккаунтов для выбранных уровней.",
    },
    error: {
      loadFailed: "Не удалось загрузить аккаунты.",
      dataRepair: {
        title: "Зашифрованные данные аккаунта требуют восстановления",
        description:
          "Приложение не смогло расшифровать локальные данные аккаунта. Обычно это означает, что данные были созданы другим ключом шифрования или локальные данные повреждены.",
        stepReLogin:
          "Если ключ по-прежнему не удается восстановить, войдите снова или добавьте затронутые аккаунты заново, не удаляя существующую базу данных.",
        stepMacPrivacy:
          "На macOS проверьте запросы Keychain/конфиденциальности. Если приложение не подписано или было переподписано, подпишите его снова, переместите в /Applications и откройте заново.",
        stepCheckGithub:
          "Проверьте README в репозитории GitHub на наличие актуальных шагов диагностики.",
        stepOpenIssue:
          "Перед очисткой локальных данных аккаунтов поищите эту ошибку в GitHub Issues.",
        openRepository: "Открыть репозиторий GitHub",
        openIssues: "Открыть GitHub Issues",
      },
    },
    toast: {
      resyncSuccessTitle: "Среды синхронизированы",
      resyncSuccessDesc: "Все среды успешно синхронизированы с {{email}}.",
      resyncPartialTitle: "Частичная синхронизация",
      resyncPartialDesc:
        "Переключено для {{succeeded}}, но произошел сбой для {{failed}}.",
      resyncFailedTitle: "Ошибка синхронизации",
      allAccountsExhaustedTitle: "Лимиты всех аккаунтов исчерпаны",
      allAccountsExhaustedDesc:
        "Лимиты всех аккаунтов в пуле сейчас исчерпаны. Добавьте аккаунт или дождитесь сброса квоты.",
      syncSuccess: {
        title: "Синхронизация успешна",
        description: "Импортирован {{email}} из IDE.",
      },
      syncFailed: {
        title: "Синхронизация не удалась",
        description: "В базе данных IDE не найдено активных аккаунтов.",
      },
      addSuccess: "Аккаунт успешно добавлен!",
      addFailed: {
        title: "Не удалось добавить аккаунт",
      },
      quotaRefreshed: "Квота обновлена",
      refreshFailed: "Не удалось обновить квоту",
      pollFailed: "Не удалось опросить квоты всех аккаунтов",
      switched: {
        title: "Аккаунт переключен!",
        description: "Перезапуск Antigravity...",
      },
      switchFailed: "Не удалось переключить аккаунт",
      deleted: "Аккаунт удален",
      deleteFailed: "Не удалось удалить аккаунт",
      deleteConfirm: "Вы уверены, что хотите удалить этот аккаунт?",
      autoSwitchOn: "Авто-переключение включено",
      autoSwitchOff: "Авто-переключение выключено",
      updateSettingsFailed: "Не удалось обновить настройки",
      actionFailed: "Не удалось выполнить действие",
      startAuthFailed: "Не удалось запустить процесс входа",
      refreshCreditsAvailable: "AI кредиты: {{amount}}",
      refreshCreditsUnavailable: "AI кредиты недоступны для этого обновления.",
      batchRefreshSuccess: "Успешно обновлено {{count}} аккаунтов.",
      batchRefreshPartial: {
        title: "Обновление завершено с проблемами",
        description:
          "Обновлено {{successful}} аккаунтов, {{failed}} с ошибкой.",
      },
      batchDeleteSuccess: "Успешно удалено {{count}} аккаунтов.",
      batchDeletePartial: {
        title: "Удаление завершено с проблемами",
        description: "Удалено {{successful}} аккаунтов, {{failed}} с ошибкой.",
      },
    },
    batch: {
      selected: "Выбрано {{count}}",
      delete: "Удалить выбранные",
      refresh: "Обновить выбранные",
      selectAll: "Выбрать все",
      clear: "Снять выделение",
      confirmDelete: "Вы уверены, что хотите удалить {{count}} аккаунтов?",
    },
    tierFilter: {
      all: "Все уровни",
      reset: "Сбросить",
      selectedCount: "{{count}} уровня",
      unknown: "Неизвестно",
    },
    sort: {
      recentlyUsed: "Недавние",
      quotaOverall: "Общая квота",
      quotaClaude: "Квота Claude",
      quotaPro3: "Квота Pro3",
      quotaFlash: "Квота Flash",
    },
    exportImport: {
      export: "Экспорт",
      import: "Импорт",
      exportTitle: "Экспорт аккаунтов",
      exportDesc:
        "Выберите, включать ли токены аутентификации в файл экспорта.",
      includeTokens: "Включить токены (менее безопасно)",
      stripTokens: "Удалить токены (безопаснее для обмена)",
      exportSuccess: "Аккаунты успешно экспортированы",
      importTitle: "Импорт аккаунтов",
      importDesc: "Выберите ранее экспортированный JSON файл.",
      importStrategy: "Стратегия импорта",
      strategyMerge: "Объединить - Обновить существующие, добавить новые",
      strategyOverwrite: "Перезаписать - Заменить все существующие данные",
      strategySkip: "Пропустить - Добавить только новые аккаунты",
      importSuccess:
        "Импортировано {{imported}}, обновлено {{updated}}, пропущено {{skipped}}",
      importErrors: "Импорт завершён с {{count}} ошибкой(ами)",
      selectFile: "Выбрать файл",
      importing: "Импорт...",
      fileTooLarge: "Размер файла превышает лимит в 5 МБ",
      invalidJson: "Некорректный формат JSON-файла",
      readFileFailed: "Не удалось прочитать файл",
    },
  },
};
export default ru;
