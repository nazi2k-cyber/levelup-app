export function getWeekStartDate() {
    const today = new Date();
    const day = today.getDay();
    const start = new Date(today);
    start.setDate(today.getDate() - day);
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
}

export function getDefaultNewUserName(lang = 'ko') {
    const defaultNames = {
        ko: '체인저',
        en: 'Changer',
        ja: 'チェンジャー',
    };
    return defaultNames[lang] || defaultNames.ko;
}

export function getInitialAppState() {
    const currentLang = (() => {
        try {
            return localStorage.getItem('lang') || 'ko';
        } catch (e) {
            return 'ko';
        }
    })();

    return {
        isLoginMode: true,
        currentLang,
        user: {
            name: getDefaultNewUserName(currentLang),
            level: 1,
            points: 50,
            stats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
            pendingStats: { str: 0, int: 0, cha: 0, vit: 0, wlth: 0, agi: 0 },
            titleHistory: [{ level: 1, title: { ko: '신규 각성자', en: 'New Awakened', ja: '新規覚醒者' } }],
            photoURL: null,
            friends: [],
            syncEnabled: false,
            gpsEnabled: false,
            pushEnabled: false,
            fcmToken: null,
            stepData: { date: '', rewardedSteps: 0, totalSteps: 0 },
            instaId: '',
            linkedinId: '',
            streak: { currentStreak: 0, lastActiveDate: null, multiplier: 1.0, activeDates: [] },
            nameLastChanged: null,
            rareTitle: { unlocked: [] },
            cameraEnabled: false,
            privateAccount: false,
            big5: null,
            isAdmin: false,
            subscription: { noAds: false, unlimitedDiyQuests: false },
        },
        quest: {
            currentDayOfWeek: new Date().getDay(),
            completedState: Array.from({ length: 7 }, () => Array(12).fill(false)),
            weekStart: getWeekStartDate(),
        },
        social: { mode: 'global', sortCriteria: 'total', users: [], savingsCurrency: '' },
        dungeon: {
            lastGeneratedDate: null,
            slot: 0,
            stationIdx: 0,
            maxParticipants: 5,
            globalParticipants: 0,
            globalProgress: 0,
            isJoined: false,
            hasContributed: false,
            targetStat: 'str',
            isCleared: false,
            bossMaxHP: 5,
            bossDamageDealt: 0,
            raidParticipants: [],
        },
        diyQuests: { definitions: [], completedToday: {}, lastResetDate: null },
        questSettings: (() => {
            try {
                const saved = localStorage.getItem('quest_settings');
                return saved ? JSON.parse(saved) : { autoAddRegular: false, autoAddDiy: true };
            } catch(e) {
                return { autoAddRegular: false, autoAddDiy: true };
            }
        })(),
        questHistory: {},
        ddays: [],
        ddayCaption: '',
        library: { books: [] },
        movies: { items: [], rewardedIds: [] },
    };
}
