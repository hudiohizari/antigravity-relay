export type TrayTexts = {
  current: string;
  quota: string;
  quota_5h: string;
  switch_next: string;
  refresh_current: string;
  show_window: string;
  quit: string;
  no_account: string;
  unknown_quota: string;
  forbidden: string;
  rate_limited: string;
  expired: string;
  current_all: string;
  target_app: string;
  target_ide: string;
  target_cli: string;
  switch_next_all: string;
  switch_target_submenu: string;
  switch_next_app: string;
  switch_next_ide: string;
  switch_next_cli: string;
  switch_next_target: string;
  not_installed: string;
};

const en: TrayTexts = {
  current: "Current",
  quota: "Quota",
  quota_5h: "5h Quota",
  switch_next: "Switch to Next Account",
  refresh_current: "Refresh Current Quota",
  show_window: "Show Main Window",
  quit: "Quit Application",
  no_account: "No Account",
  unknown_quota: "Unknown",
  forbidden: "Account Forbidden",
  rate_limited: "Rate Limited",
  expired: "Expired",
  current_all: "Current: {{email}} [All]",
  target_app: "App: {{email}}",
  target_ide: "IDE: {{email}}",
  target_cli: "CLI: {{email}}",
  switch_next_all: "Switch to Next Account (All)",
  switch_target_submenu: "Switch Specific Target",
  switch_next_app: "Switch to Next Account (App)",
  switch_next_ide: "Switch to Next Account (IDE)",
  switch_next_cli: "Switch to Next Account (CLI)",
  switch_next_target: "Switch to Next Account ({{target}})",
  not_installed: "Not Installed",
};

const zh: TrayTexts = {
  current: "当前账号",
  quota: "当前额度",
  quota_5h: "5小时额度",
  switch_next: "切换到下一个账号",
  refresh_current: "刷新当前额度",
  show_window: "显示主窗口",
  quit: "退出应用",
  no_account: "无账号",
  unknown_quota: "未知",
  forbidden: "账号已被禁用",
  rate_limited: "受速率限制",
  expired: "已过期",
  current_all: "当前账号: {{email}} [全部]",
  target_app: "应用: {{email}}",
  target_ide: "IDE: {{email}}",
  target_cli: "CLI: {{email}}",
  switch_next_all: "切换到下一个账号 (全部)",
  switch_target_submenu: "切换指定目标",
  switch_next_app: "切换到下一个账号 (应用)",
  switch_next_ide: "切换到下一个账号 (IDE)",
  switch_next_cli: "切换到下一个账号 (CLI)",
  switch_next_target: "切换到下一个账号 ({{target}})",
  not_installed: "未安装",
};

const ru: TrayTexts = {
  current: "Текущий",
  quota: "Квота",
  quota_5h: "Квота 5ч",
  switch_next: "Переключить на следующий аккаунт",
  refresh_current: "Обновить текущую квоту",
  show_window: "Показать главное окно",
  quit: "Выйти из приложения",
  no_account: "Нет аккаунта",
  unknown_quota: "Неизвестно",
  forbidden: "Аккаунт заблокирован",
  rate_limited: "Ограничение скорости",
  expired: "Истек",
  current_all: "Текущий: {{email}} [Все]",
  target_app: "Приложение: {{email}}",
  target_ide: "IDE: {{email}}",
  target_cli: "CLI: {{email}}",
  switch_next_all: "Переключить на следующий аккаунт (Все)",
  switch_target_submenu: "Переключить конкретную цель",
  switch_next_app: "Переключить на следующий аккаунт (Приложение)",
  switch_next_ide: "Переключить на следующий аккаунт (IDE)",
  switch_next_cli: "Переключить на следующий аккаунт (CLI)",
  switch_next_target: "Переключить на следующий аккаунт ({{target}})",
  not_installed: "Не установлено",
};

const vi: TrayTexts = {
  current: "Hiện tại",
  quota: "Quota",
  quota_5h: "Quota 5g",
  switch_next: "Chuyển sang tài khoản tiếp theo",
  refresh_current: "Làm mới quota hiện tại",
  show_window: "Hiện cửa sổ chính",
  quit: "Thoát ứng dụng",
  no_account: "Không có tài khoản",
  unknown_quota: "Không rõ",
  forbidden: "Tài khoản bị cấm",
  rate_limited: "Bị giới hạn tỷ lệ",
  expired: "Đã hết hạn",
  current_all: "Hiện tại: {{email}} [Tất cả]",
  target_app: "App: {{email}}",
  target_ide: "IDE: {{email}}",
  target_cli: "CLI: {{email}}",
  switch_next_all: "Chuyển sang tài khoản tiếp theo (Tất cả)",
  switch_target_submenu: "Chuyển mục tiêu cụ thể",
  switch_next_app: "Chuyển sang tài khoản tiếp theo (App)",
  switch_next_ide: "Chuyển sang tài khoản tiếp theo (IDE)",
  switch_next_cli: "Chuyển sang tài khoản tiếp theo (CLI)",
  switch_next_target: "Chuyển sang tài khoản tiếp theo ({{target}})",
  not_installed: "Chưa cài đặt",
};

const fr: TrayTexts = {
  current: "Actuel",
  quota: "Quota",
  quota_5h: "Quota 5h",
  switch_next: "Basculer vers le compte suivant",
  refresh_current: "Actualiser le quota actuel",
  show_window: "Afficher la fenetre principale",
  quit: "Quitter l application",
  no_account: "Aucun compte",
  unknown_quota: "Inconnu",
  forbidden: "Compte bloque",
  rate_limited: "Limite de debit",
  expired: "Expire",
  current_all: "Actuel: {{email}} [Tous]",
  target_app: "App: {{email}}",
  target_ide: "IDE: {{email}}",
  target_cli: "CLI: {{email}}",
  switch_next_all: "Basculer vers le compte suivant (Tous)",
  switch_target_submenu: "Basculer une cible specifique",
  switch_next_app: "Basculer vers le compte suivant (App)",
  switch_next_ide: "Basculer vers le compte suivant (IDE)",
  switch_next_cli: "Basculer vers le compte suivant (CLI)",
  switch_next_target: "Basculer vers le compte suivant ({{target}})",
  not_installed: "Non installé",
};

const tr: TrayTexts = {
  current: "Mevcut",
  quota: "Kota",
  quota_5h: "5s Kota",
  switch_next: "Sonraki Hesaba Geç",
  refresh_current: "Mevcut Kotayı Yenile",
  show_window: "Ana Pencereyi Göster",
  quit: "Uygulamadan Çık",
  no_account: "Hesap Yok",
  unknown_quota: "Bilinmiyor",
  forbidden: "Hesap Yasaklandı",
  rate_limited: "Hiz Sinirlamasi",
  expired: "Suresi Dolmus",
  current_all: "Mevcut: {{email}} [Tümü]",
  target_app: "Uygulama: {{email}}",
  target_ide: "IDE: {{email}}",
  target_cli: "CLI: {{email}}",
  switch_next_all: "Sonraki Hesaba Geç (Tümü)",
  switch_target_submenu: "Belirli Hedefe Geç",
  switch_next_app: "Sonraki Hesaba Geç (Uygulama)",
  switch_next_ide: "Sonraki Hesaba Geç (IDE)",
  switch_next_cli: "Sonraki Hesaba Geç (CLI)",
  switch_next_target: "Sonraki Hesaba Geç ({{target}})",
  not_installed: "Yüklü Değil",
};

const id: TrayTexts = {
  current: "Saat ini",
  quota: "Kuota",
  quota_5h: "Kuota 5 Jam",
  switch_next: "Ganti ke Akun Berikutnya",
  refresh_current: "Segarkan Kuota Saat Ini",
  show_window: "Tampilkan Jendela Utama",
  quit: "Keluar dari Aplikasi",
  no_account: "Tidak Ada Akun",
  unknown_quota: "Tidak Diketahui",
  forbidden: "Akun Dilarang",
  rate_limited: "Batas Laju Tercapai",
  expired: "Kedaluwarsa",
  current_all: "Saat ini: {{email}} [Semua]",
  target_app: "App: {{email}}",
  target_ide: "IDE: {{email}}",
  target_cli: "CLI: {{email}}",
  switch_next_all: "Ganti ke Akun Berikutnya (Semua)",
  switch_target_submenu: "Ganti Target Khusus",
  switch_next_app: "Ganti ke Akun Berikutnya (App)",
  switch_next_ide: "Ganti ke Akun Berikutnya (IDE)",
  switch_next_cli: "Ganti ke Akun Berikutnya (CLI)",
  switch_next_target: "Ganti ke Akun Berikutnya ({{target}})",
  not_installed: "Tidak Terinstal",
};

export function getTrayTexts(lang: string = "en"): TrayTexts {
  if (lang.startsWith("zh")) {
    return zh;
  }
  if (lang.startsWith("ru")) {
    return ru;
  }
  if (lang.startsWith("vi")) {
    return vi;
  }
  if (lang.startsWith("fr")) {
    return fr;
  }
  if (lang.startsWith("tr")) {
    return tr;
  }
  if (lang.startsWith("id")) {
    return id;
  }
  return en;
}
