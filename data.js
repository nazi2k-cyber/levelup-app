const i18n = {
    ko: {
        login_desc: "시스템에 접속하여 현실을 게임처럼.", btn_login_submit: "시스템 접속 (로그인)", btn_signup_submit: "새 플레이어 등록 (회원가입)", 
        btn_google_login: "Google로 시작", auth_toggle_signup: "계정이 없으신가요? 회원가입", auth_toggle_login: "이미 계정이 있으신가요? 로그인",
        ph_email: "이메일 (Email)", ph_pw: "비밀번호 (Password)", ph_pw_conf: "비밀번호 확인 (Confirm Password)",
        pw_req_hint: "※ 비밀번호: 8자리 이상, 대문자 1개 이상, 특수문자 2개 이상 포함",
        disclaimer_txt: "※ 가입 시 이용약관 및 면책사항에 동의하는 것으로 간주됩니다. 본 앱은 건강 보조 목적이며, 퀘스트 수행 중 발생하는 신체적 부상이나 손해에 대해 일절 책임지지 않습니다.",
        login_err_empty: "이메일과 비밀번호를 모두 입력해주세요.", login_err_email: "유효한 이메일 주소를 입력해주세요.", 
        login_err_pw_req: "비밀번호 조건(8자리 이상, 대문자 1개 이상, 특수문자 2개 이상)을 충족해주세요.", pw_mismatch: "비밀번호가 일치하지 않습니다.",
        
        nav_status: "상태창", nav_quest: "퀘스트", nav_dungeon: "던전", nav_social: "소셜", nav_settings: "설정",
        prof_name: "플레이어 (나)", btn_hist: "칭호 이력 조회", avail_pts: "보유 포인트", btn_lvlup: "레벨 업", req_pts: "요구량:",
        tot_score: "종합 스코어", radar_title: "Stat Radar", stat_hint: "※ 대기 스탯은 레벨업 시 일괄 반영됩니다.",
        str: "근력", int: "지능", cha: "매력", vit: "체력", wlth: "재력", agi: "민첩",
        bar_str: "근력 (물리/운동)", bar_int: "지능 (학습/인지)", bar_cha: "매력 (인맥/소통)", bar_vit: "체력 (수면/회복)", bar_wlth: "재력 (자본/투자)", bar_agi: "민첩 (시간/효율)",
        quest_title: "Daily Quests", quest_hint: "※ 완료 시 +20P & 스탯 +0.5", cal_title: "주간 진척도",
        raid_title: "Local Raid", raid_boss: "⚠️ 연합 보스 출현", raid_desc1: "이상 현상이 감지되었습니다.", raid_desc2: "연합 목표를 달성하고 전리품을 획득하세요.", raid_part: "참여 인원: ", raid_btn: "레이드 입장하기", raid_joined: "참여 완료", raid_success: "레이드 완료!", raid_waiting: "던전 출현 대기 중...", raid_time_info: "출현 시간: 06:00~08:00 | 11:30~13:30 | 19:00~21:00",
        soc_global: "🏆 글로벌 랭킹", soc_friend: "👥 내 친구", sort_tot: "종합스코어", sort_str: "근력", sort_int: "지능", sort_cha: "매력", sort_vit: "체력", sort_wlth: "재력", sort_agi: "민첩",
        set_title: "System Settings", set_lang: "언어 (Language)", set_theme: "라이트 모드", set_push: "푸시 알림 수신", set_gps: "앱 실행 시 현위치 탐색", set_sync: "건강 앱 동기화", set_logout: "로그아웃",
        no_friend: "등록된 친구가 없습니다.", btn_add: "친구 추가", btn_added: "친구 ✓", gps_on: "위치 권한 활성화됨", gps_off: "위치 탐색 중지됨", gps_err: "위치 정보 오류", modal_title: "칭호 이력 조회",
        name_prompt: "새로운 닉네임을 입력하세요.\n(※ 1개월에 1회만 변경 가능합니다.)", name_err: "명칭 변경은 1개월에 한 번만 가능합니다.", sync_req: "동기화 요청 중...", sync_done: "동기화 완료 (포인트 지급)", sync_off: "동기화 해제됨",
        
        // ★ 추가됨: 가이드 모달 관련 텍스트
        btn_quest_info: "가이드", btn_dungeon_info: "가이드",
        modal_quest_title: "주간 퀘스트 목록", modal_dungeon_title: "이상 현상 목록",
        th_day: "요일", th_stat: "스탯", th_quest: "퀘스트 명", th_raid: "이상 현상", th_req: "요구 데이터"
    },
    en: {
        login_desc: "Access the system, gamify your life.", btn_login_submit: "System Access (Login)", btn_signup_submit: "Register Player (Sign Up)", 
        btn_google_login: "Continue with Google", auth_toggle_signup: "No account? Sign Up", auth_toggle_login: "Already have an account? Login",
        ph_email: "Email Address", ph_pw: "Password", ph_pw_conf: "Confirm Password",
        pw_req_hint: "※ Password: 8+ chars, 1+ uppercase, 2+ special chars",
        disclaimer_txt: "※ By signing up, you agree to our Terms. This app does not provide medical advice and is not liable for injuries.",
        login_err_empty: "Please enter your email and password.", login_err_email: "Please enter a valid email address.",
        login_err_pw_req: "Password must be 8+ characters with at least 1 uppercase and 2 special characters.", pw_mismatch: "Passwords do not match.",
        
        nav_status: "Status", nav_quest: "Quests", nav_dungeon: "Dungeon", nav_social: "Social", nav_settings: "Settings",
        prof_name: "Player (Me)", btn_hist: "Title History", avail_pts: "Available Pts", btn_lvlup: "Level Up", req_pts: "Required:",
        tot_score: "Total Score", radar_title: "Stat Radar", stat_hint: "※ Pending stats are applied upon Level Up.",
        str: "STR", int: "INT", cha: "CHA", vit: "VIT", wlth: "WLTH", agi: "AGI",
        bar_str: "STR (Physical)", bar_int: "INT (Cognitive)", bar_cha: "CHA (Social)", bar_vit: "VIT (Recovery)", bar_wlth: "WLTH (Capital)", bar_agi: "AGI (Efficiency)",
        quest_title: "Daily Quests", quest_hint: "※ Earn +20P & +0.5 pending stat per quest", cal_title: "Weekly Progress",
        raid_title: "Local Raid", raid_boss: "⚠️ Alliance Boss", raid_desc1: "Anomaly detected.", raid_desc2: "Achieve alliance goals to get loot.", raid_part: "Participants: ", raid_btn: "Enter Raid", raid_joined: "Joined", raid_success: "Raid Success!", raid_waiting: "Waiting for Dungeon...", raid_time_info: "Open Hours: 06:00~08:00 | 11:30~13:30 | 19:00~21:00",
        soc_global: "🏆 Global Rank", soc_friend: "👥 My Friends", sort_tot: "Total", sort_str: "STR", sort_int: "INT", sort_cha: "CHA", sort_vit: "VIT", sort_wlth: "WLTH", sort_agi: "AGI",
        set_title: "System Settings", set_lang: "Language", set_theme: "Light Theme", set_push: "Push Notifications", set_gps: "Auto Location Tracking", set_sync: "Health App Sync", set_logout: "Logout",
        no_friend: "No friends registered.", btn_add: "Add Friend", btn_added: "Friend ✓", gps_on: "Location tracking on", gps_off: "Location tracking off", gps_err: "Location Error", modal_title: "Title History",
        name_prompt: "Enter new player name.\n(Can be changed once a month)", name_err: "Name can only be changed once a month.", sync_req: "Requesting sync...", sync_done: "Sync complete", sync_off: "Sync disabled",

        btn_quest_info: "Guide", btn_dungeon_info: "Guide",
        modal_quest_title: "Weekly Quests", modal_dungeon_title: "Anomaly List",
        th_day: "Day", th_stat: "Stat", th_quest: "Quest", th_raid: "Anomaly", th_req: "Requirement"
    },
    ja: {
        login_desc: "システムに接続し、現実をゲームのように。", btn_login_submit: "システム接続 (ログイン)", btn_signup_submit: "新規プレイヤー登録", 
        btn_google_login: "Googleで続行", auth_toggle_signup: "アカウントがありませんか？ 新規登録", auth_toggle_login: "すでにアカウントをお持ちですか？ ログイン",
        ph_email: "メールアドレス", ph_pw: "パスワード", ph_pw_conf: "パスワード (確認用)",
        pw_req_hint: "※ パスワード: 8文字以上、大文字1つ、特殊文字2つ以上",
        disclaimer_txt: "※ 登録により免責事項に同意したとみなされます。本アプリは医療的助言を提供するものではなく、怪我等について一切の責任を負いません。",
        login_err_empty: "メールアドレスとパスワードを入力してください。", login_err_email: "有効なメールアドレスを入力してください。",
        login_err_pw_req: "パスワードの条件(8文字以上、大文字1つ以上、特殊文字2つ以上)を満たしてください。", pw_mismatch: "パスワードが一致しません。",

        nav_status: "ステータス", nav_quest: "クエスト", nav_dungeon: "ダンジョン", nav_social: "ソーシャル", nav_settings: "設定",
        prof_name: "プレイヤー (私)", btn_hist: "称号履歴", avail_pts: "保有ポイント", btn_lvlup: "レベルUP", req_pts: "必要量:",
        tot_score: "総合スコア", radar_title: "ステータスレーダー", stat_hint: "※ 待機ステータスはレベルUP時に反映",
        str: "筋力", int: "知能", cha: "魅力", vit: "体力", wlth: "財力", agi: "敏捷",
        bar_str: "筋力 (運動)", bar_int: "知能 (認知)", bar_cha: "魅力 (人脈)", bar_vit: "体力 (回復)", bar_wlth: "財力 (資本)", bar_agi: "敏捷 (効率)",
        quest_title: "デイリークエスト", quest_hint: "※ 完了で +20P & 待機ステータス+0.5", cal_title: "週間進捗度",
        raid_title: "ローカルレイド", raid_boss: "⚠️ 連合ボス出現", raid_desc1: "異常現象を感知。", raid_desc2: "連合の目標を達成し戦利品を獲得せよ。", raid_part: "参加人数: ", raid_btn: "入場する", raid_joined: "参加完了", raid_success: "レイド成功！", raid_waiting: "ダンジョン出現待機中...", raid_time_info: "出現時間: 06:00~08:00 | 11:30~13:30 | 19:00~21:00",
        soc_global: "🏆 グローバルランク", soc_friend: "👥 マイフレンド", sort_tot: "総合", sort_str: "筋力", sort_int: "知能", sort_cha: "魅力", sort_vit: "体力", sort_wlth: "財力", sort_agi: "敏捷",
        set_title: "システム設定", set_lang: "言語 (Language)", set_theme: "ライトモード", set_push: "プッシュ通知受信", set_gps: "起動時の位置情報取得", set_sync: "ヘルスケアアプリ同期", set_logout: "ログアウト",
        no_friend: "友達がいません。", btn_add: "友達追加", btn_added: "友達 ✓", gps_on: "位置情報有効", gps_off: "位置情報停止", gps_err: "位置情報エラー", modal_title: "称号履歴",
        name_prompt: "新しいプレイヤー名を入力してください。\n(月に1回のみ変更可能)", name_err: "名前の変更は月に1回のみ可能です。", sync_req: "同期を要求中...", sync_done: "同期完了", sync_off: "同期解除",

        btn_quest_info: "ガイド", btn_dungeon_info: "ガイド",
        modal_quest_title: "週間クエスト一覧", modal_dungeon_title: "異常現象一覧",
        th_day: "曜日", th_stat: "ステータス", th_quest: "クエスト名", th_raid: "異常現象", th_req: "要求データ"
    }
};

/* 이후 기존 titleVocab, weeklyQuestData, seoulStations, raidMissions, mockSocialData 코드는 그대로 유지 */
