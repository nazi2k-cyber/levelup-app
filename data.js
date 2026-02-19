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
        // ★ 명칭 수정됨 ★
        set_title: "System Settings", set_lang: "언어 (Language)", set_theme: "라이트 모드", set_push: "푸시 알림 수신", set_gps: "앱 실행 시 현위치 탐색", set_sync: "구글 피트니스 앱 동기화", set_logout: "로그아웃",
        no_friend: "등록된 친구가 없습니다.", btn_add: "친구 추가", btn_added: "친구 ✓", gps_on: "위치 권한 활성화됨", gps_off: "위치 탐색 중지됨", gps_err: "위치 정보 오류", modal_title: "칭호 이력 조회",
        name_prompt: "새로운 닉네임을 입력하세요.\n(※ 1개월에 1회만 변경 가능합니다.)", name_err: "명칭 변경은 1개월에 한 번만 가능합니다.", sync_req: "동기화 요청 중...", sync_done: "동기화 완료 (포인트 지급)", sync_off: "동기화 해제됨",
        
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
        // ★ 명칭 수정됨 ★
        set_title: "System Settings", set_lang: "Language", set_theme: "Light Theme", set_push: "Push Notifications", set_gps: "Auto Location Tracking", set_sync: "Google Fit Sync", set_logout: "Logout",
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
        // ★ 명칭 수정됨 ★
        set_title: "システム設定", set_lang: "言語 (Language)", set_theme: "ライトモード", set_push: "プッシュ通知受信", set_gps: "起動時の位置情報取得", set_sync: "Google Fit 同期", set_logout: "ログアウト",
        no_friend: "友達がいません。", btn_add: "友達追加", btn_added: "友達 ✓", gps_on: "位置情報有効", gps_off: "位置情報停止", gps_err: "位置情報エラー", modal_title: "称号履歴",
        name_prompt: "新しいプレイヤー名を入力してください。\n(月に1回のみ変更可能)", name_err: "名前の変更は月に1回のみ可能です。", sync_req: "同期を要求中...", sync_done: "同期完了", sync_off: "同期解除",

        btn_quest_info: "ガイド", btn_dungeon_info: "ガイド",
        modal_quest_title: "週間クエスト一覧", modal_dungeon_title: "異常現象一覧",
        th_day: "曜日", th_stat: "ステータス", th_quest: "クエスト名", th_raid: "異常現象", th_req: "要求データ"
    }
};

const titleVocab = {
    str: { ko: { pre: ["강인한", "거친", "부서지지 않는"], suf: ["곰", "바위", "거인"] }, en: { pre: ["Strong", "Tough", "Unbreakable"], suf: ["Bear", "Rock", "Giant"] }, ja: { pre: ["強靭な", "荒々しい", "砕けない"], suf: ["熊", "岩", "巨人"] } },
    int: { ko: { pre: ["지혜로운", "꿰뚫어보는", "깊은"], suf: ["올빼미", "호수", "현자"] }, en: { pre: ["Wise", "Piercing", "Deep"], suf: ["Owl", "Lake", "Sage"] }, ja: { pre: ["知恵のある", "見抜く", "深い"], suf: ["フクロウ", "湖", "賢者"] } },
    cha: { ko: { pre: ["매혹적인", "빛나는", "사람을 끄는"], suf: ["여우", "불꽃", "별"] }, en: { pre: ["Charming", "Shining", "Magnetic"], suf: ["Fox", "Flame", "Star"] }, ja: { pre: ["魅力的な", "輝く", "惹きつける"], কয়েক", "炎", "星"] } },
    vit: { ko: { pre: ["지치지 않는", "끈질긴", "숨쉬는"], suf: ["거북이", "대지", "뿌리"] }, en: { pre: ["Tireless", "Persistent", "Breathing"], suf: ["Turtle", "Earth", "Root"] }, ja: { pre: ["疲れない", "粘り強い", "息づく"], suf: ["亀", "大地", "根"] } },
    wlth:{ ko: { pre: ["풍족한", "황금을 쥔", "계산하는"], suf: ["두꺼비", "태양", "보석"] }, en: { pre: ["Abundant", "Golden", "Calculating"], suf: ["Toad", "Sun", "Gem"] }, ja: { pre: ["豊かな", "黄金を握る", "計算する"], suf: ["ヒキガエル", "太陽", "宝石"] } },
    agi: { ko: { pre: ["날쌘", "바람을 가르는", "보이지 않는"], suf: ["표범", "화살", "매"] }, en: { pre: ["Swift", "Wind-cleaving", "Unseen"], suf: ["Panther", "Arrow", "Hawk"] }, ja: { pre: ["素早い", "風を切る", "見えない"], suf: ["ヒョウ", "矢", "鷹"] } }
};

const statKeys = ['str', 'int', 'cha', 'vit', 'wlth', 'agi'];

const weeklyQuestData = [
    [ { stat: "STR", title: {ko:"휴식과 산책", en:"Rest & Walk", ja:"休息と散歩"}, desc: {ko:"30분 걷기", en:"30 min walk", ja:"30分歩行"} }, { stat: "STR", title: {ko:"코어 강화", en:"Core Strength", ja:"コア強化"}, desc: {ko:"플랭크 3세트", en:"3 plank sets", ja:"プランク3回"} }, { stat: "INT", title: {ko:"주간 계획", en:"Weekly Plan", ja:"週間計画"}, desc: {ko:"일정 정리", en:"Plan schedule", ja:"予定整理"} }, { stat: "INT", title: {ko:"독서 타임", en:"Reading", ja:"読書"}, desc: {ko:"비문학 1챕터", en:"Read 1 chapter", ja:"1章読む"} }, { stat: "CHA", title: {ko:"자기 반성", en:"Reflection", ja:"自己反省"}, desc: {ko:"일기 작성", en:"Write journal", ja:"日記作成"} }, { stat: "CHA", title: {ko:"외적 정돈", en:"Grooming", ja:"身だしなみ"}, desc: {ko:"옷 다림질", en:"Iron clothes", ja:"服の準備"} }, { stat: "VIT", title: {ko:"반신욕", en:"Bath", ja:"半身浴"}, desc: {ko:"피로 풀기", en:"Relieve fatigue", ja:"疲労回復"} }, { stat: "VIT", title: {ko:"영양 균형", en:"Diet", ja:"栄養"}, desc: {ko:"채소 위주 식단", en:"Veg-heavy meal", ja:"野菜中心食事"} }, { stat: "WLTH", title: {ko:"월간 목표", en:"Monthly Goal", ja:"月間目標"}, desc: {ko:"저축 목표", en:"Set saving goal", ja:"貯蓄目標"} }, { stat: "WLTH", title: {ko:"자산 리뷰", en:"Net Worth", ja:"資産確認"}, desc: {ko:"자산 점검", en:"Check net worth", ja:"資産点検"} }, { stat: "AGI", title: {ko:"디지털 정리", en:"Declutter", ja:"デジタル整理"}, desc: {ko:"앱 삭제", en:"Delete apps", ja:"アプリ削除"} }, { stat: "AGI", title: {ko:"루틴 세팅", en:"Alarms", ja:"アラーム"}, desc: {ko:"알람 세팅", en:"Set alarm", ja:"準備"} } ],
    [ { stat: "STR", title: {ko:"1만보 달성", en:"10k Steps", ja:"1万歩"}, desc: {ko:"걷기 늘리기", en:"Walk more", ja:"歩行追加"} }, { stat: "STR", title: {ko:"푸쉬업", en:"Pushups", ja:"腕立て伏せ"}, desc: {ko:"푸쉬업 3세트", en:"3 sets", ja:"3セット"} }, { stat: "INT", title: {ko:"독서 습관", en:"Reading", ja:"読書習慣"}, desc: {ko:"10페이지 읽기", en:"Read 10 pages", ja:"10ページ"} }, { stat: "INT", title: {ko:"지식 청취", en:"Podcast", ja:"ポッドキャスト"}, desc: {ko:"경제 팟캐스트", en:"Eco podcast", ja:"経済聴取"} }, { stat: "CHA", title: {ko:"감사 표현", en:"Gratitude", ja:"感謝"}, desc: {ko:"동료에게 감사", en:"Thank a colleague", ja:"同僚に感謝"} }, { stat: "CHA", title: {ko:"스킨케어", en:"Skincare", ja:"スキンケア"}, desc: {ko:"보습제 바르기", en:"Apply lotion", ja:"保湿"} }, { stat: "VIT", title: {ko:"수분 충전", en:"Hydration", ja:"水分補給"}, desc: {ko:"물 2리터", en:"Drink 2L water", ja:"水2L"} }, { stat: "VIT", title: {ko:"멘탈 케어", en:"Meditation", ja:"瞑想"}, desc: {ko:"10분 명상", en:"10 mins med", ja:"10分瞑想"} }, { stat: "WLTH", title: {ko:"무지출", en:"No Spend", ja:"無支出"}, desc: {ko:"소비 참기", en:"Avoid spending", ja:"消費我慢"} }, { stat: "WLTH", title: {ko:"시황 체크", en:"Market", ja:"市況"}, desc: {ko:"기사 스크랩", en:"Finance article", ja:"金融記事"} }, { stat: "AGI", title: {ko:"우선순위", en:"Prioritize", ja:"優先順位"}, desc: {ko:"Top 3 업무", en:"Top 3 tasks", ja:"上位3業務"} }, { stat: "AGI", title: {ko:"뽀모도로", en:"Pomodoro", ja:"ポモドーロ"}, desc: {ko:"30분 집중", en:"30 min focus", ja:"30分集中"} } ],
    [ { stat: "STR", title: {ko:"중량 타격", en:"Weights", ja:"ウェイト"}, desc: {ko:"30분 웨이트", en:"30 min lift", ja:"30分"} }, { stat: "STR", title: {ko:"단백질", en:"Protein", ja:"タンパク質"}, desc: {ko:"단백질 식사", en:"Protein meal", ja:"食事"} }, { stat: "INT", title: {ko:"단어 수집", en:"Vocab", ja:"単語"}, desc: {ko:"새 단어 3개", en:"3 new words", ja:"新単語3つ"} }, { stat: "INT", title: {ko:"업계 동향", en:"Trend", ja:"トレンド"}, desc: {ko:"블로그 읽기", en:"Read blog", ja:"ブログ"} }, { stat: "CHA", title: {ko:"칭찬하기", en:"Compliment", ja:"褒める"}, desc: {ko:"장점 칭찬", en:"Praise someone", ja:"長所を褒める"} }, { stat: "CHA", title: {ko:"아이컨택", en:"Eye Contact", ja:"アイコンタクト"}, desc: {ko:"눈 맞추기", en:"Make eye contact", ja:"目を合わせる"} }, { stat: "VIT", title: {ko:"수면", en:"Sleep", ja:"睡眠"}, desc: {ko:"7시간 확보", en:"Sleep 7+ hrs", ja:"7時間"} }, { stat: "VIT", title: {ko:"카페인 통제", en:"No Caffeine", ja:"カフェイン減"}, desc: {ko:"오후 2시 이후 X", en:"None after 2pm", ja:"午後なし"} }, { stat: "WLTH", title: {ko:"가계부", en:"Expense Track", ja:"家計簿"}, desc: {ko:"지출 내역 정리", en:"Track daily", ja:"支出整理"} }, { stat: "WLTH", title: {ko:"소액 저축", en:"Micro Save", ja:"少額貯金"}, desc: {ko:"여윳돈 저축", en:"Save small amt", ja:"貯蓄"} }, { stat: "AGI", title: {ko:"심박수", en:"HR Up", ja:"心拍数"}, desc: {ko:"15분 러닝", en:"15 min run", ja:"15分ラン"} }, { stat: "AGI", title: {ko:"인박스 제로", en:"Inbox Zero", ja:"受信トレイ"}, desc: {ko:"밀린 답장", en:"Clear inbox", ja:"返信"} } ],
    [ { stat: "STR", title: {ko:"하체 강화", en:"Leg Day", ja:"下半身"}, desc: {ko:"계단 오르기", en:"Stairs", ja:"階段"} }, { stat: "STR", title: {ko:"스트레칭", en:"Stretch", ja:"ストレッチ"}, desc: {ko:"전신 10분", en:"10 mins", ja:"10分"} }, { stat: "INT", title: {ko:"인사이트", en:"Insight", ja:"インサイト"}, desc: {ko:"TED 강연", en:"Watch TED", ja:"TED"} }, { stat: "INT", title: {ko:"기록", en:"Record", ja:"記録"}, desc: {ko:"배운 점 요약", en:"1 line summary", ja:"1行要約"} }, { stat: "CHA", title: {ko:"네트워킹", en:"Network", ja:"ネット"}, desc: {ko:"SNS 포스팅", en:"Post on SNS", ja:"SNS投稿"} }, { stat: "CHA", title: {ko:"미소", en:"Smile", ja:"笑顔"}, desc: {ko:"미소 연습", en:"Smile practice", ja:"練習"} }, { stat: "VIT", title: {ko:"당류 제한", en:"No Sugar", ja:"糖質制限"}, desc: {ko:"단것 피하기", en:"Avoid sweets", ja:"避ける"} }, { stat: "VIT", title: {ko:"식후 산책", en:"Walk", ja:"散歩"}, desc: {ko:"10분 걷기", en:"10 min walk", ja:"10分歩行"} }, { stat: "WLTH", title: {ko:"경제 지식", en:"Study", ja:"勉強"}, desc: {ko:"자산 공부", en:"Learn crypto", ja:"資産勉強"} }, { stat: "WLTH", title: {ko:"포트폴리오", en:"Portfolio", ja:"ポートフォリオ"}, desc: {ko:"수익률 점검", en:"Check returns", ja:"収益点検"} }, { stat: "AGI", title: {ko:"타임 블로킹", en:"Time Block", ja:"時間管理"}, desc: {ko:"내일 일정", en:"Plan tmrw", ja:"予定"} }, { stat: "AGI", title: {ko:"공간 정리", en:"Clean", ja:"片付け"}, desc: {ko:"5분 정리", en:"5 min clean", ja:"5分"} } ],
    [ { stat: "STR", title: {ko:"등 근육", en:"Back", ja:"背筋"}, desc: {ko:"턱걸이", en:"Pullups", ja:"懸垂"} }, { stat: "STR", title: {ko:"바른 자세", en:"Posture", ja:"姿勢"}, desc: {ko:"거북목 교정", en:"Fix neck", ja:"首矯正"} }, { stat: "INT", title: {ko:"논리력", en:"Logic", ja:"論理"}, desc: {ko:"퍼즐 풀기", en:"Puzzles", ja:"パズル"} }, { stat: "INT", title: {ko:"복습", en:"Review", ja:"復習"}, desc: {ko:"메모 재확인", en:"Review notes", ja:"メモ確認"} }, { stat: "CHA", title: {ko:"가족 통화", en:"Call", ja:"電話"}, desc: {ko:"안부 묻기", en:"Call family", ja:"連絡"} }, { stat: "CHA", title: {ko:"향기", en:"Scent", ja:"香り"}, desc: {ko:"향수 사용", en:"Use perfume", ja:"香水"} }, { stat: "VIT", title: {ko:"디톡스", en:"Detox", ja:"デトックス"}, desc: {ko:"자기 전 폰 끄기", en:"No phone", ja:"スマホオフ"} }, { stat: "VIT", title: {ko:"심호흡", en:"Breath", ja:"呼吸"}, desc: {ko:"4-7-8 호흡", en:"Deep breath", ja:"深呼吸"} }, { stat: "WLTH", title: {ko:"구독 점검", en:"Subs", ja:"サブスク"}, desc: {ko:"안 쓰는 해지", en:"Cancel unused", ja:"解約"} }, { stat: "WLTH", title: {ko:"사이드 허슬", en:"Hustle", ja:"副業"}, desc: {ko:"수입 구상", en:"Income idea", ja:"アイデア"} }, { stat: "AGI", title: {ko:"더블 뽀모도로", en:"Focus", ja:"集中"}, desc: {ko:"1시간 집중", en:"1 hr focus", ja:"1時間"} }, { stat: "AGI", title: {ko:"2분 룰", en:"2-Min", ja:"2分"}, desc: {ko:"즉시 하기", en:"Do it now", ja:"すぐやる"} } ],
    [ { stat: "STR", title: {ko:"전신 운동", en:"Full Body", ja:"全身"}, desc: {ko:"스쿼트+버피", en:"Squat+Burpee", ja:"スクワット"} }, { stat: "STR", title: {ko:"비타민", en:"Vitamin", ja:"ビタミン"}, desc: {ko:"영양제 섭취", en:"Take pills", ja:"サプリ"} }, { stat: "INT", title: {ko:"교양", en:"Culture", ja:"教養"}, desc: {ko:"다큐 시청", en:"Watch doc", ja:"ドキュメンタリー"} }, { stat: "INT", title: {ko:"딥 워크", en:"Deep Work", ja:"没頭"}, desc: {ko:"1시간 학습", en:"1 hr study", ja:"1時間学習"} }, { stat: "CHA", title: {ko:"도움 주기", en:"Help", ja:"助け"}, desc: {ko:"동료 돕기", en:"Help someone", ja:"手伝う"} }, { stat: "CHA", title: {ko:"경청", en:"Listen", ja:"傾聴"}, desc: {ko:"말 끊지 않기", en:"Don't interrupt", ja:"遮らない"} }, { stat: "VIT", title: {ko:"음주 조절", en:"Control", ja:"節酒"}, desc: {ko:"술 줄이기", en:"Drink less", ja:"減らす"} }, { stat: "VIT", title: {ko:"안구 휴식", en:"Eye Rest", ja:"目の休息"}, desc: {ko:"먼 곳 보기", en:"Look away", ja:"遠くを見る"} }, { stat: "WLTH", title: {ko:"주간 예산", en:"Budget", ja:"予算"}, desc: {ko:"초과 확인", en:"Check budget", ja:"確認"} }, { stat: "WLTH", title: {ko:"자동 이체", en:"Auto", ja:"自動振替"}, desc: {ko:"적금 확인", en:"Check auto-save", ja:"確認"} }, { stat: "AGI", title: {ko:"주간 리뷰", en:"Review", ja:"振り返り"}, desc: {ko:"달성률 체크", en:"Check goals", ja:"達成率"} }, { stat: "AGI", title: {ko:"주말 계획", en:"Plan", ja:"週末計画"}, desc: {ko:"일정 잡기", en:"Set plans", ja:"予定"} } ],
    [ { stat: "STR", title: {ko:"야외 러닝", en:"Run", ja:"ラン"}, desc: {ko:"5km 조깅", en:"5km jog", ja:"5km"} }, { stat: "STR", title: {ko:"요가", en:"Yoga", ja:"ヨガ"}, desc: {ko:"15분 유연성", en:"15 min flex", ja:"15分"} }, { stat: "INT", title: {ko:"취미", en:"Hobby", ja:"趣味"}, desc: {ko:"유튜브 30분", en:"30 min YT", ja:"30分"} }, { stat: "INT", title: {ko:"뇌 휴식", en:"Brain Rest", ja:"脳休息"}, desc: {ko:"활자 없는 시간", en:"No text", ja:"活字なし"} }, { stat: "CHA", title: {ko:"지인 만남", en:"Meet", ja:"会う"}, desc: {ko:"친구 연락", en:"Contact friend", ja:"連絡"} }, { stat: "CHA", title: {ko:"취향 공유", en:"Share", ja:"共有"}, desc: {ko:"추천하기", en:"Recommend", ja:"推薦"} }, { stat: "VIT", title: {ko:"낮잠", en:"Nap", ja:"昼寝"}, desc: {ko:"파워 낮잠", en:"Power nap", ja:"仮眠"} }, { stat: "VIT", title: {ko:"햇빛 쬐기", en:"Sun", ja:"日光浴"}, desc: {ko:"15분 야외", en:"15 mins out", ja:"15分"} }, { stat: "WLTH", title: {ko:"부동산/임장", en:"Real Estate", ja:"不動産"}, desc: {ko:"시세 보기", en:"Check prices", ja:"相場"} }, { stat: "WLTH", title: {ko:"주말 예산", en:"Budget", ja:"予算"}, desc: {ko:"한도 설정", en:"Set limit", ja:"限度"} }, { stat: "AGI", title: {ko:"밀프렙", en:"Meal Prep", ja:"作り置き"}, desc: {ko:"재료 손질", en:"Prep food", ja:"準備"} }, { stat: "AGI", title: {ko:"집안일", en:"Chores", ja:"家事"}, desc: {ko:"대청소", en:"Cleaning", ja:"掃除"} } ]
];

const seoulStations = [
    { name: {ko: "강남역", en: "Gangnam Stn", ja: "江南駅"}, lat: 37.4979, lng: 127.0276 },
    { name: {ko: "홍대입구역", en: "Hongdae Stn", ja: "弘大入口駅"}, lat: 37.5568, lng: 126.9242 },
    { name: {ko: "잠실역", en: "Jamsil Stn", ja: "蚕室駅"}, lat: 37.5133, lng: 127.1001 },
    { name: {ko: "여의도역", en: "Yeouido Stn", ja: "汝矣島駅"}, lat: 37.5216, lng: 126.9241 },
    { name: {ko: "신도림역", en: "Sindorim Stn", ja: "新道林駅"}, lat: 37.5088, lng: 126.8912 }
];

const raidMissions = {
    str: {
        stat: "STR", color: "var(--neon-red)",
        title: {ko: "물리 법칙 붕괴: 중력 이상 현상", en: "Physics Collapse: Gravity Anomaly", ja: "物理法則崩壊: 重力異常"},
        desc1: {ko: "해당 구역에 강력한 무기력장(게으름)이 퍼지고 있습니다.", en: "Strong lethargy field is expanding.", ja: "無気力場が広がっています。"},
        desc2: {ko: "헌터 연합 합산 1만보 걷기 또는 홈트/짐 30분 운동 기록을 동기화하여 중력장을 상쇄하십시오.", en: "Sync 10k steps or 30m workout data.", ja: "1万歩または30分運動データを同期せよ。"},
        actionText: {ko: "운동 데이터 송신", en: "Transmit Workout Data", ja: "運動データ送信"}
    },
    int: {
        stat: "INT", color: "var(--neon-blue)",
        title: {ko: "정보 왜곡 지대: 인지 마비 안개", en: "Info Distortion: Cognitive Fog", ja: "情報歪曲: 認知麻痺の霧"},
        desc1: {ko: "집단 지성을 저하시키는 왜곡장이 감지되었습니다.", en: "Field degrading collective intelligence detected.", ja: "集団知性を低下させる歪曲場を感知。"},
        desc2: {ko: "독서 1챕터, 아티클 요약, 또는 30분 이상의 어학/학습 기록을 업로드하여 왜곡을 돌파하십시오.", en: "Upload 1 chapter read or 30m study log.", ja: "読書1章または30分の学習記録をアップロードせよ。"},
        actionText: {ko: "학습 로그 업로드", en: "Upload Study Log", ja: "学習ログアップロード"}
    },
    cha: {
        stat: "CHA", color: "var(--neon-purple)",
        title: {ko: "고립의 장벽: 단절의 넥서스", en: "Wall of Isolation: Disconnect Nexus", ja: "孤立の障壁: 断絶のネクサス"},
        desc1: {ko: "현대인들을 단절시키는 고립의 장벽이 세워졌습니다.", en: "Barrier of isolation disconnecting people.", ja: "人々を断絶させる孤立の障壁。"},
        desc2: {ko: "지인에게 안부 메시지 전송, 동료에게 감사 표현, 또는 커피 한 잔의 여유를 인증하여 연결망을 복구하십시오.", en: "Message a friend, show gratitude, or share coffee.", ja: "友人に連絡するか、感謝を伝えよ。"},
        actionText: {ko: "소셜 버프 발동", en: "Activate Social Buff", ja: "ソーシャルバフ発動"}
    },
    vit: {
        stat: "VIT", color: "#00ff66",
        title: {ko: "생명력 탈취 역장: 피로의 늪", en: "Vitality Drain Field: Swamp of Fatigue", ja: "生命力奪取 역장: 疲労の沼"},
        desc1: {ko: "주변 헌터들의 생명력을 서서히 흡수하는 만성 피로 구역입니다.", en: "Zone absorbing hunters' vitality.", ja: "ハンターの生命力を吸収する力場。"},
        desc2: {ko: "물 2리터 마시기, 영양제 섭취, 또는 7시간 수면 기록을 시스템에 증명하여 역장을 정화하십시오.", en: "Drink 2L water, take vitamins, or sleep 7h.", ja: "水2L、サプリ、または7時間睡眠を証明せよ。"},
        actionText: {ko: "회복 데이터 증명", en: "Prove Recovery Data", ja: "回復データ証明"}
    },
    wlth: {
        stat: "WLTH", color: "var(--neon-gold)",
        title: {ko: "자본 유출 넥서스: 가치 붕괴 포털", en: "Capital Leak Nexus: Value Collapse Portal", ja: "資本流出ネクサス: 価値崩壊ポータル"},
        desc1: {ko: "해당 좌표에서 경제적 가치(통장 잔고)가 줄줄 새고 있습니다.", en: "Economic value is leaking here.", ja: "経済的価値が漏出しています。"},
        desc2: {ko: "오늘 하루 불필요한 지출 방어(무지출), 소액 저축, 또는 경제 뉴스 1편 스크랩을 통해 포털을 닫으십시오.", en: "No-spend day, micro-save, or read eco news.", ja: "無支出、少額貯蓄、または経済ニュースを読め。"},
        actionText: {ko: "자산 방어 프로토콜 가동", en: "Activate Asset Defense", ja: "資産防御プロトコル稼働"}
    },
    agi: {
        stat: "AGI", color: "#ff8c00",
        title: {ko: "시간 지연 게이트: 타임 패러독스", en: "Time Dilation Gate: Time Paradox", ja: "時間遅延ゲート: タイムパラドックス"},
        desc1: {ko: "이 구역의 일 처리 속도가 심각하게 지연되고 있습니다.", en: "Productivity is severely delayed here.", ja: "この区域の生産性が深刻に遅延しています。"},
        desc2: {ko: "뽀모도로(25분 집중) 1세트 완료, 혹은 밀린 업무/집안일 3가지 처리 로그를 전송해 시간을 가속하십시오.", en: "1 Pomodoro or complete 3 pending tasks.", ja: "ポモドーロ1回またはタスク3つ完了せよ。"},
        actionText: {ko: "효율성 로그 전송", en: "Transmit Efficiency Log", ja: "効率ログ送信"}
    }
};

const mockSocialData = [];
