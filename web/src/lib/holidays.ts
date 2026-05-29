/**
 * Comprehensive international holiday database.
 *
 * Sources:
 *  - UN official list of international days (un.org/en/observances)
 *  - Wikipedia: List of national independence days
 *  - Wikipedia: List of international observances
 *  - National Today / Days of the Year (individual date cross-checks)
 *
 * Fixed-date holidays are keyed "MM-DD". Multiple observances on the same
 * date are listed with the most globally significant first.
 *
 * Floating holidays (Easter cycle, US federal moving observances) are
 * computed below and merged at runtime.
 */

// ---------------------------------------------------------------------------
// Fixed holidays keyed by "MM-DD"
// ---------------------------------------------------------------------------

const FIXED: Record<string, string[]> = {

  // ── January ────────────────────────────────────────────────────────────
  "01-01": ["New Year's Day", "Haiti Independence Day", "Cuba Liberation Day",
            "Cameroon Independence Day", "Sudan Independence Day",
            "Samoa Independence Day"],
  "01-04": ["World Braille Day", "Myanmar Independence Day"],
  "01-06": ["Epiphany", "Three Kings Day", "Día de Reyes"],
  "01-07": ["Orthodox Christmas"],
  "01-11": ["Antigua and Barbuda Independence Day"],
  "01-14": ["Makar Sankranti"],
  "01-19": ["Orthodox Epiphany", "Timkat (Ethiopia)"],
  "01-24": ["International Day of Education"],
  "01-25": ["Burns Night"],
  "01-26": ["Republic Day (India)", "Australia Day",
            "International Day of Clean Energy"],
  "01-27": ["International Holocaust Remembrance Day"],
  "01-28": ["International Day of Peaceful Coexistence"],
  "01-31": ["Nauru Independence Day"],

  // ── February ───────────────────────────────────────────────────────────
  "02-02": ["Groundhog Day", "Candlemas", "Imbolc", "World Wetlands Day"],
  "02-04": ["Sri Lanka Independence Day", "International Day of Human Fraternity"],
  "02-06": ["Waitangi Day (New Zealand)",
            "International Day of Zero Tolerance to Female Genital Mutilation",
            "Sami National Day"],
  "02-07": ["Grenada Independence Day"],
  "02-10": ["World Pulses Day"],
  "02-11": ["International Day of Women and Girls in Science",
            "National Foundation Day (Japan)"],
  "02-12": ["Darwin Day"],
  "02-13": ["World Radio Day"],
  "02-14": ["Valentine's Day"],
  "02-17": ["Kosovo Independence Day", "Global Tourism Resilience Day"],
  "02-18": ["The Gambia Independence Day"],
  "02-20": ["World Day of Social Justice"],
  "02-21": ["International Mother Language Day"],
  "02-22": ["Saint Lucia Independence Day"],
  "02-24": ["Estonia Independence Day"],
  "02-27": ["Dominican Republic Independence Day"],

  // ── March ──────────────────────────────────────────────────────────────
  "03-01": ["Zero Discrimination Day", "St. David's Day (Wales)",
            "World Seagrass Day"],
  "03-02": ["Morocco Independence Day"],
  "03-03": ["World Wildlife Day", "Bulgaria Liberation Day"],
  "03-06": ["Ghana Independence Day"],
  "03-08": ["International Women's Day"],
  "03-11": ["Lithuania Independence Restoration Day"],
  "03-12": ["Mauritius Independence Day"],
  "03-14": ["Pi Day"],
  "03-15": ["International Day to Combat Islamophobia"],
  "03-17": ["St. Patrick's Day"],
  "03-19": ["St. Joseph's Day"],
  "03-20": ["International Day of Happiness", "Nowruz",
            "International Day of Nowruz", "French Language Day"],
  "03-21": ["World Down Syndrome Day", "World Poetry Day",
            "International Day of Forests",
            "International Day for the Elimination of Racial Discrimination",
            "World Day for Glaciers", "Namibia Independence Day"],
  "03-22": ["World Water Day"],
  "03-23": ["Pakistan Day", "World Meteorological Day"],
  "03-24": ["World Tuberculosis Day",
            "International Day for the Right to the Truth"],
  "03-25": ["Greek Independence Day", "Feast of the Annunciation",
            "International Day of Remembrance of the Victims of Slavery"],
  "03-26": ["Bangladesh Independence Day"],
  "03-30": ["International Day of Zero Waste"],
  "03-31": ["César Chávez Day"],

  // ── April ──────────────────────────────────────────────────────────────
  "04-01": ["April Fools' Day"],
  "04-02": ["World Autism Awareness Day"],
  "04-04": ["International Day for Mine Awareness", "Senegal Independence Day"],
  "04-05": ["International Day of Conscience"],
  "04-06": ["International Day of Sport for Development and Peace"],
  "04-07": ["World Health Day",
            "International Day of Reflection on the Genocide against the Tutsi in Rwanda"],
  "04-09": ["Georgia Restoration of Independence Day"],
  "04-12": ["International Day of Human Space Flight", "Yuri's Night"],
  "04-14": ["World Chagas Disease Day"],
  "04-17": ["Syria Evacuation Day"],
  "04-18": ["Zimbabwe Independence Day"],
  "04-21": ["World Creativity and Innovation Day", "Tiradentes Day (Brazil)"],
  "04-22": ["Earth Day", "International Mother Earth Day"],
  "04-23": ["World Book and Copyright Day", "St. George's Day",
            "English Language Day", "Spanish Language Day",
            "National Sovereignty and Children's Day (Turkey)"],
  "04-24": ["Armenian Genocide Remembrance Day",
            "International Girls in ICT Day"],
  "04-25": ["ANZAC Day", "World Malaria Day", "Italy Liberation Day",
            "Portugal Carnation Revolution Day"],
  "04-26": ["World Intellectual Property Day",
            "International Chernobyl Disaster Remembrance Day"],
  "04-27": ["King's Day (Netherlands)", "Sierra Leone Independence Day",
            "South Africa Freedom Day"],
  "04-28": ["World Day for Safety and Health at Work"],
  "04-29": ["International Day in Memory of Victims of Earthquakes"],
  "04-30": ["International Jazz Day"],

  // ── May ────────────────────────────────────────────────────────────────
  "05-01": ["International Workers' Day", "May Day", "Labour Day", "Beltane"],
  "05-02": ["World Tuna Day"],
  "05-03": ["World Press Freedom Day", "Polish Constitution Day"],
  "05-04": ["Star Wars Day"],
  "05-05": ["Cinco de Mayo", "Children's Day (Japan & South Korea)",
            "Europe Day (Council of Europe)"],
  "05-08": ["V-E Day", "World Red Cross and Red Crescent Day",
            "Time of Remembrance and Reconciliation for WWII"],
  "05-09": ["Europe Day (EU)", "Victory Day", "World Migratory Bird Day"],
  "05-10": ["International Day of Argania"],
  "05-12": ["International Day of Plant Health"],
  "05-14": ["Paraguay Independence Day"],
  "05-15": ["International Day of Families"],
  "05-16": ["International Day of Light",
            "International Day of Living Together in Peace"],
  "05-17": ["Norway Constitution Day (Syttende Mai)",
            "World Telecommunication and Information Society Day",
            "International Day Against Homophobia, Transphobia and Biphobia"],
  "05-19": ["World Fair Play Day",
            "Commemoration of Atatürk and Youth and Sports Day (Turkey)"],
  "05-20": ["World Bee Day", "East Timor Independence Day"],
  "05-21": ["International Tea Day",
            "World Day for Cultural Diversity for Dialogue and Development"],
  "05-22": ["International Day for Biological Diversity",
            "Yemen Unification Day"],
  "05-23": ["International Day to End Obstetric Fistula"],
  "05-24": ["Eritrea Independence Day", "International Day of the Markhor"],
  "05-25": ["Africa Day", "Jordan Independence Day", "World Football Day",
            "Argentina Revolution Day (May Revolution)",
            "Towel Day (tribute to Douglas Adams)"],
  "05-26": ["Guyana Independence Day"],
  "05-27": ["Togo Independence Day"],
  "05-28": ["Amnesty International Day", "World Hunger Day",
            "Philippines National Flag Day",
            "Armenia First Republic Day", "Azerbaijan Republic Day",
            "International Day of Action on Women's Health"],
  "05-29": ["International Day of UN Peacekeepers"],
  "05-30": ["International Day of Potato"],
  "05-31": ["World No-Tobacco Day"],

  // ── June ───────────────────────────────────────────────────────────────
  "06-01": ["International Children's Day", "Global Day of Parents",
            "Kenya Madaraka Day"],
  "06-03": ["World Bicycle Day", "Montenegro Independence Day"],
  "06-04": ["International Day of Innocent Children Victims of Aggression",
            "Tonga National Day"],
  "06-05": ["World Environment Day", "Denmark Constitution Day (Grundlovsdag)"],
  "06-06": ["Russian Language Day", "Sweden National Day"],
  "06-07": ["World Food Safety Day"],
  "06-08": ["World Oceans Day"],
  "06-10": ["Portugal National Day", "Day of Portugal and Camões"],
  "06-12": ["Philippines Independence Day", "Russia Day",
            "World Day Against Child Labour"],
  "06-13": ["International Albinism Awareness Day"],
  "06-14": ["Flag Day (US)", "World Blood Donor Day"],
  "06-15": ["World Elder Abuse Awareness Day"],
  "06-16": ["International Day of Family Remittances",
            "South Africa Youth Day (Soweto Uprising 1976)"],
  "06-17": ["Iceland National Day (Republic Day)",
            "World Day to Combat Desertification and Drought",
            "Bunker Hill Day (Massachusetts)"],
  "06-18": ["Sustainable Gastronomy Day",
            "International Day for Countering Hate Speech"],
  "06-19": ["Juneteenth",
            "International Day for the Elimination of Sexual Violence in Conflict",
            "Kuwait Independence Day"],
  "06-20": ["World Refugee Day"],
  "06-21": ["International Day of Yoga", "Fête de la Musique (World Music Day)",
            "Midsummer", "International Day of the Celebration of the Solstice"],
  "06-23": ["Luxembourg National Day", "United Nations Public Service Day",
            "International Widows' Day"],
  "06-24": ["Feast of Saint John the Baptist", "Saint-Jean-Baptiste Day (Québec)",
            "Inti Raymi (Andean New Year)", "International Day of Women in Diplomacy"],
  "06-25": ["Mozambique Independence Day", "Slovenia Independence Day",
            "Croatia Independence Day", "Day of the Seafarer"],
  "06-26": ["International Day against Drug Abuse and Illicit Trafficking",
            "UN International Day in Support of Victims of Torture"],
  "06-27": ["Djibouti Independence Day", "International Day of Deafblindness"],
  "06-29": ["Seychelles Independence Day", "Feast of Saints Peter and Paul"],
  "06-30": ["DRC Independence Day", "International Asteroid Day",
            "International Day of Parliamentarism"],

  // ── July ───────────────────────────────────────────────────────────────
  "07-01": ["Canada Day", "Burundi Independence Day", "Rwanda Independence Day",
            "Somalia Independence Day", "Ghana Republic Day",
            "International Day of Cooperatives"],
  "07-04": ["Independence Day (United States)"],
  "07-05": ["Algeria Independence Day", "Cape Verde Independence Day",
            "Venezuela Independence Day"],
  "07-06": ["Comoros Independence Day", "Malawi Independence Day",
            "World Rural Development Day"],
  "07-07": ["Solomon Islands Independence Day", "World Kiswahili Language Day"],
  "07-09": ["Argentina Independence Day", "South Sudan Independence Day"],
  "07-10": ["The Bahamas Independence Day"],
  "07-11": ["World Population Day",
            "International Day of Reflection on the 1995 Srebrenica Genocide"],
  "07-12": ["São Tomé and Príncipe Independence Day",
            "Kiribati Independence Day", "International Malala Day"],
  "07-14": ["Bastille Day (France)", "Fête Nationale"],
  "07-17": ["World Emoji Day"],
  "07-18": ["Nelson Mandela International Day"],
  "07-20": ["World Chess Day", "International Moon Day",
            "Colombia Independence Day"],
  "07-22": ["Feast of Mary Magdalene", "Pi Approximation Day"],
  "07-25": ["International Day of Women and Girls of African Descent",
            "World Drowning Prevention Day"],
  "07-26": ["Liberia Independence Day", "Maldives Independence Day",
            "Cuba National Day (Moncada)"],
  "07-28": ["World Hepatitis Day", "Peru Independence Day"],
  "07-30": ["International Day of Friendship",
            "World Day against Trafficking in Persons",
            "Vanuatu Independence Day"],

  // ── August ─────────────────────────────────────────────────────────────
  "08-01": ["Swiss National Day", "Benin Independence Day",
            "World Breastfeeding Week begins"],
  "08-03": ["Niger Independence Day"],
  "08-05": ["Burkina Faso Independence Day"],
  "08-06": ["Hiroshima Peace Memorial Day", "Jamaica Independence Day"],
  "08-07": ["Ivory Coast (Côte d'Ivoire) Independence Day"],
  "08-08": ["International Cat Day"],
  "08-09": ["Singapore National Day",
            "International Day of the World's Indigenous Peoples"],
  "08-10": ["Ecuador Independence Day"],
  "08-11": ["Chad Independence Day"],
  "08-12": ["International Youth Day"],
  "08-13": ["Central African Republic Independence Day"],
  "08-14": ["Pakistan Independence Day"],
  "08-15": ["India Independence Day", "Assumption of Mary",
            "South Korea Liberation Day (Gwangbokjeol)",
            "Liechtenstein National Day", "DRC Independence Day"],
  "08-16": ["Dominican Republic Restoration of Independence"],
  "08-17": ["Indonesia Independence Day", "Gabon Independence Day"],
  "08-19": ["Afghanistan Independence Day", "World Humanitarian Day"],
  "08-21": ["International Day of Remembrance and Tribute to Victims of Terrorism"],
  "08-22": ["International Day Commemorating Victims of Acts of Violence Based on Religion or Belief"],
  "08-23": ["International Day for the Remembrance of the Slave Trade and Its Abolition"],
  "08-24": ["Ukraine Independence Day"],
  "08-25": ["Uruguay Independence Day", "Belarus Independence Day"],
  "08-27": ["Moldova Independence Day"],
  "08-29": ["International Day against Nuclear Tests"],
  "08-30": ["International Day of the Victims of Enforced Disappearances"],
  "08-31": ["International Day for People of African Descent",
            "Malaysia Independence Day", "Trinidad and Tobago Independence Day",
            "Kyrgyzstan Independence Day"],

  // ── September ──────────────────────────────────────────────────────────
  "09-01": ["Uzbekistan Independence Day", "World Letter Writing Day",
            "Slovakia Constitution Day"],
  "09-02": ["Vietnam National Day"],
  "09-05": ["International Day of Charity (Mother Teresa Day)"],
  "09-06": ["Eswatini (Swaziland) Independence Day"],
  "09-07": ["Brazil Independence Day",
            "International Day of Clean Air for Blue Skies"],
  "09-08": ["International Literacy Day", "North Macedonia Independence Day"],
  "09-09": ["Tajikistan Independence Day"],
  "09-15": ["International Day of Democracy",
            "Central American Independence Day (Costa Rica, El Salvador, Guatemala, Honduras, Nicaragua)"],
  "09-16": ["Mexico Independence Day", "Papua New Guinea Independence Day",
            "International Day for the Preservation of the Ozone Layer"],
  "09-17": ["World Patient Safety Day"],
  "09-18": ["Chile National Day", "International Equal Pay Day"],
  "09-19": ["Saint Kitts and Nevis Independence Day"],
  "09-21": ["International Day of Peace", "Belize Independence Day",
            "Malta Independence Day", "Armenia Independence Day"],
  "09-22": ["Mali Independence Day"],
  "09-23": ["Saudi Arabia National Day", "International Day of Sign Languages"],
  "09-24": ["World Maritime Day", "Guinea-Bissau Independence Day"],
  "09-26": ["International Day for the Total Elimination of Nuclear Weapons"],
  "09-27": ["World Tourism Day"],
  "09-28": ["International Day for Universal Access to Information"],
  "09-29": ["International Day of Awareness of Food Loss and Waste"],
  "09-30": ["International Translation Day", "Botswana Independence Day"],

  // ── October ────────────────────────────────────────────────────────────
  "10-01": ["China National Day", "Nigeria Independence Day",
            "International Coffee Day", "International Day of Older Persons",
            "Cyprus Independence Day", "Tuvalu Independence Day",
            "Palau Independence Day"],
  "10-02": ["International Day of Non-Violence", "Gandhi Jayanti (India)"],
  "10-03": ["German Unity Day"],
  "10-04": ["Lesotho Independence Day", "World Space Week begins"],
  "10-05": ["World Teachers' Day"],
  "10-06": ["World Habitat Day"],
  "10-07": ["World Cotton Day"],
  "10-09": ["World Post Day", "Uganda Independence Day",
            "Hangul Day (South Korea)"],
  "10-10": ["World Mental Health Day", "Fiji Day",
            "Cuba Day of National Culture (Grito de Yara, 1868)"],
  "10-11": ["International Day of the Girl Child",
            "National Coming Out Day"],
  "10-12": ["Columbus Day / Indigenous Peoples' Day",
            "Spain National Day (Día de la Hispanidad)",
            "Equatorial Guinea Independence Day"],
  "10-13": ["International Day for Disaster Risk Reduction"],
  "10-15": ["International Day of Rural Women"],
  "10-16": ["World Food Day"],
  "10-17": ["International Day for the Eradication of Poverty"],
  "10-18": ["Azerbaijan Independence Day"],
  "10-21": ["Marshall Islands Independence Day"],
  "10-24": ["United Nations Day", "Zambia Independence Day",
            "World Development Information Day"],
  "10-26": ["Austria National Day"],
  "10-27": ["Saint Vincent and the Grenadines Independence Day",
            "Turkmenistan Independence Day"],
  "10-28": ["Czech Statehood Day", "Greece Ohi Day"],
  "10-29": ["Turkey Republic Day"],
  "10-31": ["Halloween", "All Hallows' Eve", "Samhain", "World Cities Day"],

  // ── November ───────────────────────────────────────────────────────────
  "11-01": ["All Saints' Day", "Día de los Muertos",
            "Antigua and Barbuda Independence Day"],
  "11-02": ["All Souls' Day", "Day of the Dead"],
  "11-03": ["Dominica Independence Day", "Panama Independence Day",
            "Micronesia Independence Day"],
  "11-05": ["Guy Fawkes Night (Bonfire Night)", "World Tsunami Awareness Day"],
  "11-06": ["International Day for Preventing the Exploitation of the Environment in War and Armed Conflict"],
  "11-09": ["Fall of the Berlin Wall (1989)", "Cambodia Independence Day"],
  "11-10": ["World Science Day for Peace and Development"],
  "11-11": ["Veterans Day (United States)", "Remembrance Day (Canada/UK/Commonwealth)",
            "Armistice Day", "Poland Independence Day",
            "Angola Independence Day"],
  "11-13": ["World Kindness Day"],
  "11-14": ["World Diabetes Day"],
  "11-15": ["International Day for Prevention of Transnational Organized Crime"],
  "11-16": ["International Day for Tolerance",
            "International Day of the Mediterranean Diet"],
  "11-17": ["International Students' Day",
            "World Day of Remembrance for Road Traffic Victims"],
  "11-18": ["Latvia Proclamation Day (Independence Day)",
            "Oman National Day"],
  "11-19": ["Monaco National Day", "International Men's Day",
            "World Toilet Day"],
  "11-20": ["Universal Children's Day (World Children's Day)",
            "Transgender Day of Remembrance",
            "Africa Industrialization Day"],
  "11-21": ["World Television Day", "World Philosophy Day"],
  "11-22": ["Lebanon Independence Day"],
  "11-25": ["International Day for the Elimination of Violence against Women",
            "Suriname Independence Day"],
  "11-26": ["World Sustainable Transport Day"],
  "11-28": ["Albania Independence Day", "Mauritania Independence Day"],
  "11-29": ["International Day of Solidarity with the Palestinian People"],
  "11-30": ["St. Andrew's Day (Scotland)", "Barbados Independence Day",
            "Day of Remembrance for All Victims of Chemical Warfare"],

  // ── December ───────────────────────────────────────────────────────────
  "12-01": ["World AIDS Day", "Romania National Day (Great Union Day)"],
  "12-02": ["International Day for the Abolition of Slavery",
            "UAE National Day", "Laos National Day"],
  "12-03": ["International Day of Persons with Disabilities"],
  "12-04": ["International Day Against Unilateral Coercive Measures"],
  "12-05": ["Finland Independence Day", "World Soil Day",
            "International Volunteer Day"],
  "12-06": ["St. Nicholas Day"],
  "12-07": ["International Civil Aviation Day",
            "Pearl Harbor Remembrance Day"],
  "12-08": ["Feast of the Immaculate Conception"],
  "12-09": ["International Anti-Corruption Day",
            "International Day of Commemoration and Dignity of Victims of Genocide"],
  "12-10": ["Human Rights Day"],
  "12-11": ["International Mountain Day"],
  "12-12": ["Feast of Our Lady of Guadalupe (Mexico)",
            "International Universal Health Coverage Day",
            "Kenya Jamhuri Day"],
  "12-16": ["Day of Reconciliation (South Africa)",
            "Kazakhstan Independence Day", "Bahrain National Day"],
  "12-18": ["Qatar National Day", "International Migrants Day",
            "Arabic Language Day"],
  "12-20": ["International Human Solidarity Day"],
  "12-21": ["Winter Solstice", "Yule", "World Meditation Day",
            "World Basketball Day"],
  "12-24": ["Christmas Eve", "Libya Independence Day"],
  "12-25": ["Christmas Day"],
  "12-26": ["Boxing Day", "Kwanzaa begins", "St. Stephen's Day"],
  "12-27": ["International Day of Epidemic Preparedness"],
  "12-31": ["New Year's Eve"],
};

// ---------------------------------------------------------------------------
// Floating holiday helpers
// ---------------------------------------------------------------------------

/** Easter Sunday — Meeus/Jones/Butcher anonymous Gregorian algorithm. */
function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

/** nth occurrence of weekday (0 = Sun … 6 = Sat) in a month (0-indexed). */
function nthWeekday(year: number, month: number, nth: number, weekday: number): Date {
  const first  = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (nth - 1) * 7);
}

/** Last occurrence of weekday in a month (0-indexed). */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last   = new Date(year, month + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth() &&
    a.getDate()     === b.getDate();
}

interface FloatingHoliday { date: Date; names: string[] }

function floatingHolidaysForYear(year: number): FloatingHoliday[] {
  const easter = easterDate(year);
  return [
    // Easter cycle
    { date: addDays(easter, -46), names: ["Ash Wednesday"] },
    { date: addDays(easter, -7),  names: ["Palm Sunday"] },
    { date: addDays(easter, -3),  names: ["Maundy Thursday"] },
    { date: addDays(easter, -2),  names: ["Good Friday"] },
    { date: easter,               names: ["Easter Sunday"] },
    { date: addDays(easter,  1),  names: ["Easter Monday"] },
    { date: addDays(easter, 39),  names: ["Ascension Day"] },
    { date: addDays(easter, 49),  names: ["Pentecost Sunday"] },
    { date: addDays(easter, 50),  names: ["Whit Monday"] },
    // US federal floating observances
    { date: nthWeekday(year, 0, 3, 1),  names: ["Martin Luther King Jr. Day"] },
    { date: nthWeekday(year, 1, 3, 1),  names: ["Presidents' Day", "Washington's Birthday"] },
    { date: nthWeekday(year, 4, 2, 0),  names: ["Mother's Day"] },
    { date: lastWeekday(year, 4, 1),    names: ["Memorial Day"] },
    { date: nthWeekday(year, 5, 3, 0),  names: ["Father's Day"] },
    { date: nthWeekday(year, 8, 1, 1),  names: ["Labor Day"] },
    { date: nthWeekday(year, 9, 2, 1),  names: ["Columbus Day", "Indigenous Peoples' Day"] },
    { date: nthWeekday(year, 10, 4, 4), names: ["Thanksgiving Day"] },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns all holiday names that fall on the given date.
 * Pass a Date whose year/month/day reflect local (Pacific) time.
 * The first element is the most globally significant observance.
 */
export function getHolidaysForDate(date: Date): string[] {
  const mm  = String(date.getMonth() + 1).padStart(2, '0');
  const dd  = String(date.getDate()).padStart(2, '0');
  const key = `${mm}-${dd}`;

  const names: string[] = [];

  if (FIXED[key]) names.push(...FIXED[key]);

  for (const { date: hd, names: hn } of floatingHolidaysForYear(date.getFullYear())) {
    if (sameDay(date, hd)) names.push(...hn);
  }

  return names;
}
