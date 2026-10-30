(() => {
  const page = document.querySelector('.settings-page');
  const pageTitle = document.querySelector('#page-title');
  const headingActions = document.querySelector('#page-heading-actions');
  const tabs = document.querySelector('.tabs');
  const pageNotice = document.querySelector('#page-notice');
  const drawerRoot = document.querySelector('#drawer-root');
  let auditDrawerTrigger = null;
  if (!page || !pageTitle || !headingActions || !tabs || typeof render !== 'function') return;

  const legacyRender = render;
  const legacyRenderPanel = renderPanel;
  const closeAnimationMs = 150;
  const dataDelay = 420;

  Object.assign(paths, {
    download: 'M12 3v11m0 0 4-4m-4 4-4-4M5 14v5h14v-5',
    filter: 'M4 5h16l-6 7v5l-4 2v-7L4 5z',
    upRight: 'M7 17 17 7M9 7h8v8',
    downLeft: 'M17 7 7 17m8 0H7V9',
    statusAlert: 'M12 7v6M12 17h.01',
    more: 'M12 6h.01M12 12h.01M12 18h.01',
    card: 'M5 3h14v18H5zM8 7h8M8 11h5',
    key: 'M14 7a5 5 0 1 0-4 8l2-2h3v-3h3l2-2-3-3-3 2z',
    trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5',
    flag: 'M5 21V4m0 1h11l-2 4 2 4H5',
    snow: 'M12 2v20M4 7l16 10M20 7 4 17M9 4l3 3 3-3M9 20l3-3 3 3',
    deactivate: 'M12 8v4m0 4h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    chevronLeft: 'm15 18-6-6 6-6',
    chevronRight: 'm9 18 6-6-6-6',
    doubleLeft: 'm13 17-5-5 5-5m5 10-5-5 5-5',
    doubleRight: 'm6 17 5-5-5-5m5 10 5-5-5-5',
    inbox: 'M4 5h16v14H4zM4 14h5l1.5 2h3L15 14h5',
    refresh: 'M20 7v5h-5M4 17v-5h5M6 8a7 7 0 0 1 12-2l2 6M18 16a7 7 0 0 1-12 2l-2-6',
    calendar: 'M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1z',
    trend: 'm4 16 5-5 4 4 7-8M15 7h5v5',
    basket: 'M5 10h14l-1 10H6L5 10zM9 10l3-6 3 6',
    wallet: 'M4 6h14a2 2 0 0 1 2 2v11H4V6zm0 3h16m-5 4h5v4h-5z',
    copy: 'M8 8h11v11H8zM4 4h11v3M4 4v11h3',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 12h17M12 3c2.2 2.4 3.3 5.4 3.3 9S14.2 18.6 12 21M12 3C9.8 5.4 8.7 8.4 8.7 12s1.1 6.6 3.3 9',
    pin: 'M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
    event: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6 7.7 7.7M16.3 16.3l2.1 2.1M5.6 18.4 7.7 16.3M16.3 7.7l2.1-2.1M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
    diamond: 'M12 5.5 18.5 12 12 18.5 5.5 12z'
  });

  const avatarColors = [
    ['#d9edff', '#258ee4', '#173b5c', '#8ecbff'], ['#ffe6cd', '#f08a24', '#55331a', '#ffc082'],
    ['#c9f3df', '#1ba667', '#173f2f', '#8ce2b8'], ['#ffd7d9', '#e3494f', '#502326', '#ff9da2'],
    ['#fff0c9', '#cc8a00', '#4b3a14', '#ffd778'], ['#c8f2f4', '#1e9ca3', '#164044', '#8edee2'],
    ['#f7d4ff', '#d63be6', '#4c1d55', '#efa1f7'], ['#ddd5ff', '#7456ec', '#302553', '#b9a8ff']
  ];

  const transactionSeed = [
    ['Adebayo Afolabi', 'Withdrawal', 'First Bank of Nigeria', 'Successful', 5432782, '10-01-2026 3:45pm'],
    ['Chinonso Uche', 'Funding', 'Access Bank', 'Successful', 2124568.75, '09-30-2026 2:30pm'],
    ['Efe Okwuosa', 'Withdrawal', 'Zenith Bank', 'Pending', 9876543.1, '09-29-2026 1:15pm'],
    ['Temitope Adeyemi', 'Funding', 'United Bank for Africa', 'Failed', 1234567.8, '09-28-2026 12:00pm'],
    ['Uchechukwu Eze', 'Withdrawal', 'Citibank Nigeria', 'Successful', 3210987.45, '09-19-2026 03:30am'],
    ['Sola Adeola', 'Funding', 'Heritage Bank', 'Successful', 2345678.9, '09-22-2026 06:00am'],
    ['Opeoluwa Afolabi', 'Withdrawal', 'Jaiz Bank', 'Successful', 9999999.99, '09-21-2026 05:50am'],
    ['Oluwafemi Ajayi', 'Withdrawal', 'Ecobank Nigeria', 'Successful', 4567890, '09-25-2026 09:30am'],
    ['Ngozi Ibe', 'Funding', 'Sterling Bank', 'Successful', 6789012.3, '09-24-2026 08:20am'],
    ['Dayo Bakare', 'Withdrawal', 'Keystone Bank', 'Successful', 4321098.76, '09-17-2026 01:10am'],
    ['Chijioke Nwosu', 'Withdrawal', 'Polaris Bank', 'Successful', 8910111.65, '09-23-2026 07:10am'],
    ['Ifedayo Okeke', 'Withdrawal', 'FCMB', 'Successful', 3456789.5, '09-27-2026 11:50am'],
    ['Ibukun Adebisi', 'Withdrawal', 'SunTrust Bank', 'Successful', 7654321, '09-15-2026 11:00pm'],
    ['Folashade Olatunji', 'Funding', 'Standard Chartered Bank Nigeria', 'Successful', 1111111.11, '09-18-2026 02:20am'],
    ['Damilola Olasunkanmi', 'Funding', 'Wema Bank', 'Successful', 7890123.4, '09-26-2026 10:40am'],
    ['Kehinde Ogunleye', 'Funding', 'Union Bank of Nigeria', 'Successful', 5678901.2, '09-20-2026 04:40am'],
    ['Tolu Oyekan', 'Funding', 'Bank of Industry', 'Successful', 8888888.88, '09-16-2026 12:00am'],
    ['Amaka Eze', 'Withdrawal', 'Stanbic IBTC', 'Pending', 1450900, '09-14-2026 08:25am'],
    ['Bode Lawal', 'Funding', 'Fidelity Bank', 'Failed', 980000, '09-13-2026 04:12pm'],
    ['Zainab Musa', 'Funding', 'Guaranty Trust Bank', 'Successful', 6350200, '09-12-2026 01:45pm']
  ];

  const transactions = Array.from({ length: 200 }, (_, index) => {
    const seed = transactionSeed[index % transactionSeed.length];
    return { id: `TXN-${90818 + index}`, name: seed[0], direction: seed[1], source: seed[2], status: seed[3], amount: seed[4] + index * 173.25, date: seed[5] };
  });

  const accountProfile = {
    balance: 1000000.45,
    details: [
      ['Account number', '0123456789'],
      ['Account holder', 'Money Making Business'],
      ['Bank name', 'Community Federal Savings Bank (CFSB)'],
      ['Account type', 'Checking'],
      ['US Bank address', '1323 Columbus Avenue San Francisco, CA 94133 United States']
    ]
  };

  const accountSeed = [
    ['Funding', 'First Bank of Nigeria', 'Pending', 6789012, '09-29-2026 10:15pm'],
    ['Funding', 'First Bank of Nigeria', 'Failed', 7654321, '09-28-2026 12:00pm'],
    ['Funding', 'First Bank of Nigeria', 'Successful', 4567890, '10-01-2026 03:45pm'],
    ['Funding', 'First Bank of Nigeria', 'Successful', 5432100, '09-30-2026 02:30pm'],
    ['Funding', 'First Bank of Nigeria', 'Successful', 3456789, '09-19-2026 03:30am'],
    ['Funding', 'First Bank of Nigeria', 'Successful', 2987654, '09-22-2026 06:00am'],
    ['Funding', 'Wema Bank', 'Successful', 8123456, '09-26-2026 10:40am'],
    ['Funding', 'Union Bank of Nigeria', 'Successful', 5432109, '09-20-2026 04:40am'],
    ['Funding', 'Bank of Industry', 'Successful', 9876543, '09-16-2026 12:00am']
  ];

  const accountHistorySeed = [
    ['Withdrawal', 'Community Federal Savings Bank', 'Successful', 1250000, '09-15-2026 09:12am'],
    ['Funding', 'Access Bank', 'Successful', 2310400, '09-13-2026 11:26am'],
    ['Withdrawal', 'Zenith Bank', 'Pending', 640500, '09-14-2026 04:08pm'],
    ['Funding', 'Sterling Bank', 'Successful', 1875300, '09-11-2026 08:55am'],
    ['Withdrawal', 'Guaranty Trust Bank', 'Failed', 980750, '09-12-2026 02:40pm'],
    ['Withdrawal', 'Stanbic IBTC', 'Successful', 3120900, '09-10-2026 01:18pm'],
    ['Funding', 'Fidelity Bank', 'Successful', 745200, '09-09-2026 10:02am']
  ];

  const accountTransactions = [
    ...accountSeed,
    ...Array.from({ length: 59 }, (_, index) => {
      const seed = accountHistorySeed[index % accountHistorySeed.length];
      return [seed[0], seed[1], seed[2], seed[3] + index * 1043.5, seed[4]];
    })
  ].map(([direction, counterparty, status, amount, date], index) => ({ id: `ACT-${52140 + index}`, direction, counterparty, status, amount, date }));

  const userSeed = [
    ['Adaeze Chukwu', 'adaeze.chukwu@gmail.com', 'Business', 'Active', 128, '03-14-2025'],
    ['Ibrahim Suleiman', 'ibrahim.suleiman@gmail.com', 'Starter', 'Active', 42, '06-02-2025'],
    ['Ronke Bello', 'ronke.bello@gmail.com', 'Enterprise', 'Active', 891, '11-19-2024'],
    ['Kunle Adisa', 'kunle.adisa@gmail.com', 'Starter', 'Pending', 3, '08-21-2026'],
    ['Chiamaka Obi', 'chiamaka.obi@gmail.com', 'Business', 'Suspended', 214, '01-08-2025'],
    ['Tunde Fashola', 'tunde.fashola@gmail.com', 'Enterprise', 'Active', 1345, '05-30-2024'],
    ['Halima Yusuf', 'halima.yusuf@gmail.com', 'Starter', 'Active', 17, '07-11-2026'],
    ['Emeka Anyanwu', 'emeka.anyanwu@gmail.com', 'Business', 'Active', 356, '02-27-2025'],
    ['Bisi Okoro', 'bisi.okoro@gmail.com', 'Starter', 'Suspended', 8, '04-15-2026'],
    ['Yakubu Danladi', 'yakubu.danladi@gmail.com', 'Enterprise', 'Active', 672, '09-09-2024'],
    ['Grace Etim', 'grace.etim@gmail.com', 'Business', 'Active', 199, '10-02-2025'],
    ['Femi Ogundipe', 'femi.ogundipe@gmail.com', 'Starter', 'Pending', 1, '08-27-2026']
  ];

  const users = Array.from({ length: 64 }, (_, index) => {
    const seed = userSeed[index % userSeed.length];
    return { id: `USR-${40210 + index}`, name: seed[0], email: seed[1], tier: seed[2], status: seed[3], orders: seed[4] + index, joined: seed[5] };
  });

  const orderSeed = [
    ['Adaeze Chukwu', 'Buy', 'FGN Bond 2031', 'Successful', 2450000, '09-29-2026 10:12am'],
    ['Ibrahim Suleiman', 'Sell', 'MTN Nigeria', 'Successful', 780500, '09-28-2026 03:44pm'],
    ['Ronke Bello', 'Buy', 'Dangote Cement', 'Successful', 5120300, '09-27-2026 09:05am'],
    ['Kunle Adisa', 'Buy', 'Treasury Bill 91D', 'Pending', 320000, '09-27-2026 01:30pm'],
    ['Chiamaka Obi', 'Sell', 'GTCO', 'Failed', 940200, '09-26-2026 11:52am'],
    ['Tunde Fashola', 'Buy', 'Zenith Bank', 'Successful', 1610750, '09-25-2026 04:18pm'],
    ['Halima Yusuf', 'Sell', 'Airtel Africa', 'Successful', 460900, '09-24-2026 08:40am'],
    ['Emeka Anyanwu', 'Buy', 'BUA Foods', 'Successful', 2205600, '09-23-2026 02:15pm'],
    ['Bisi Okoro', 'Sell', 'Access Holdings', 'Pending', 128400, '09-22-2026 12:05pm'],
    ['Yakubu Danladi', 'Buy', 'Nestle Nigeria', 'Successful', 3390100, '09-21-2026 05:33pm'],
    ['Grace Etim', 'Sell', 'FGN Bond 2031', 'Successful', 970800, '09-20-2026 10:48am'],
    ['Femi Ogundipe', 'Buy', 'Treasury Bill 182D', 'Failed', 215300, '09-19-2026 03:22pm']
  ];

  const orders = Array.from({ length: 140 }, (_, index) => {
    const seed = orderSeed[index % orderSeed.length];
    return { id: `ORD-${71040 + index}`, name: seed[0], type: seed[1], instrument: seed[2], status: seed[3], amount: seed[4] + index * 411.6, date: seed[5] };
  });

  // ---------- Audit log ----------

  // Each actor carries the role shown in the table's Role column.
  const auditActors = [
    ['Oyeleye', 'Oyeleye Ogunsanya', 'Admin'],
    ['Adebayo', 'Adebayo Johnson', 'Customer support'],
    ['Damilola', 'Damilola Adeyemi', 'Customer support'],
    ['Yemi', 'Yemi Balogun', 'Customer support'],
    ['Emeka', 'Emeka Nwosu', 'Customer support'],
    ['Malik', 'Malik Abubakar', 'Customer support'],
    ['Bola', 'Bola Smith', 'Customer support'],
    ['Hassan', 'Hassan Bello', 'Developer'],
    ['Stephen', 'Stephen Okonkwo', 'Operation']
  ];

  // Activity verb -> semantic tone. Tone is paired with the verb label and a
  // marker icon, never used as the only cue.
  const auditVerbs = {
    Created: 'success', Reactivated: 'success', Updated: 'info', Invited: 'accent',
    Suspended: 'warning', Flagged: 'warning', Deleted: 'danger', Cancelled: 'danger', Deactivated: 'danger'
  };

  // Field changes recorded per verb, so the drawer's Changes table reflects
  // what the activity actually altered.
  const auditChangeTemplates = {
    'Updated user role': [['Role', 'Customer support', 'Operations']],
    'Updated user profile': [['Email address', 'a.johnson@company.com', 'ajohnson123@company.com'], ['Phone number', '+44 7700 900122', '+44 7700 900841']],
    Suspended: [['Account status', 'Active', 'Suspended']],
    Deactivated: [['Account status', 'Active', 'Deactivated']],
    Reactivated: [['Account status', 'Suspended', 'Active']],
    Flagged: [['Review status', 'Not flagged', 'Flagged for review']],
    Cancelled: [['Status', 'Processing', 'Cancelled']],
    Invited: [['Invitation', 'None', 'Sent']],
    Created: [['Account status', 'None', 'Active']],
    Deleted: [['Account status', 'Active', 'Deleted']]
  };

  const auditLocations = ['Manchester, United Kingdom', 'Lagos, Nigeria', 'London, United Kingdom', 'Abuja, Nigeria', 'Dublin, Ireland'];
  const auditDevices = ['Windows 11 · Chrome 128.0', 'macOS 15 · Safari 18.0', 'Windows 10 · Firefox 130.0', 'Ubuntu 24.04 · Chrome 127.0'];
  const auditIps = ['817.178.200.30', '105.112.4.18', '197.210.83.6', '41.58.16.44', '154.113.9.71'];

  // Overview values the reference screen states for the event it details.
  const auditReferenceDetails = {
    7: {
      date: '10-02-2026 04:00pm',
      location: 'Manchester, United Kingdom',
      device: 'Windows 11 · Chrome 128.0',
      ip: '817.178.200.30',
      eventId: 'evt_1907uytgbt5678kkoli789'
    }
  };

  // The first entries mirror the reference screen; the rest extend the log so
  // pagination, filtering and prev/next navigation have real depth.
  const auditEventSeed = [
    ['Oyeleye', 'Updated', 'user profile', 'AJohnson123@company.com', 'Amara Johnson'],
    ['Adebayo', 'Created', 'User', 'QAllen87@company.com', 'Quincy Allen'],
    ['Damilola', 'Suspended', 'User', 'PTaylor55@company.com', 'Priya Taylor'],
    ['Yemi', 'Deleted', 'User', 'KYoung99@company.com', 'Kwame Young'],
    ['Emeka', 'Flagged', 'withdrawal', 'WD-194910', ''],
    ['Malik', 'Reactivated', 'user', 'RLee34@company.com', 'Rita Lee'],
    ['Oyeleye', 'Invited', 'member', 'NSmith09@company.com', 'Nadia Smith'],
    ['Oyeleye', 'Updated', 'user role', 'OJackson60@company.com', 'Chinonso Uche'],
    ['Bola', 'Cancelled', 'order', 'ORD-482000', ''],
    ['Hassan', 'Created', 'user', 'SWhite32@company.com', 'Sade White'],
    ['Hassan', 'Updated', 'user profile', 'BRoberts45@company.com', 'Bimpe Roberts'],
    ['Hassan', 'Updated', 'user profile', 'LAnderson77@company.com', 'Lara Anderson'],
    ['Oyeleye', 'Deactivated', 'user', 'CClark101@company.com', 'Chidi Clark'],
    ['Stephen', 'Cancelled', 'withdrawal', 'WD-194920', ''],
    ['Stephen', 'Flagged', 'user', 'TWalker48@company.com', 'Tunde Walker'],
    ['Stephen', 'Cancelled', 'order', 'ORD-482900', ''],
    ['Bola', 'Cancelled', 'order', 'ORD-482910', ''],
    ['Damilola', 'Updated', 'user role', 'MOsei22@company.com', 'Maryam Osei'],
    ['Emeka', 'Suspended', 'User', 'DAdeleke73@company.com', 'Dele Adeleke'],
    ['Malik', 'Invited', 'member', 'FIkenna15@company.com', 'Femi Ikenna']
  ];

  function auditTargetType(label) {
    if (label.startsWith('ORD-')) return 'order';
    if (label.startsWith('WD-')) return 'withdrawal';
    return 'member';
  }

  function auditChangesFor(verb, object) {
    return (auditChangeTemplates[`${verb} ${object}`] || auditChangeTemplates[verb] || [])
      .map(([field, before, after]) => ({ field, before, after }));
  }

  // Newest first, stepping back 47 minutes per entry from the reference stamp.
  const auditStart = new Date(2026, 9, 1, 15, 45).getTime();
  const auditStep = 47 * 60000;

  function auditTimestamp(index) {
    const at = new Date(auditStart - index * auditStep);
    const pad = value => String(value).padStart(2, '0');
    const hours = at.getHours();
    const suffix = hours >= 12 ? 'pm' : 'am';
    return `${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${at.getFullYear()} ${pad(hours % 12 || 12)}:${pad(at.getMinutes())}${suffix}`;
  }

  const auditLog = Array.from({ length: 72 }, (_, index) => {
    const [actorKey, verb, object, targetLabel, targetName] = auditEventSeed[index % auditEventSeed.length];
    const actor = auditActors.find(entry => entry[0] === actorKey);
    const reference = auditReferenceDetails[index] || {};
    const suffix = index < auditEventSeed.length ? '' : `-${Math.floor(index / auditEventSeed.length)}`;
    const label = auditTargetType(targetLabel) === 'member'
      ? targetLabel.replace('@', `${suffix}@`)
      : `${targetLabel}${suffix}`;
    return {
      id: `LOG-${58000 + index}`,
      eventId: reference.eventId || `evt_${1907 + index}uytgbt${5678 + index * 7}kkoli${(789 + index * 13) % 1000}`,
      date: reference.date || auditTimestamp(index),
      at: auditStart - index * auditStep,
      actor: actor[0],
      actorName: actor[1],
      role: actor[2],
      verb,
      object,
      title: `${verb} ${object}`.replace(/\b\w/g, character => character.toUpperCase()),
      target: { label, name: targetName, type: auditTargetType(targetLabel) },
      location: reference.location || auditLocations[index % auditLocations.length],
      device: reference.device || auditDevices[index % auditDevices.length],
      ip: reference.ip || auditIps[index % auditIps.length],
      status: index % 17 === 5 ? 'Failed' : 'Success',
      changes: auditChangesFor(verb, object)
    };
  });

  const apiKeys = [
    { id: 'key-1', name: 'Checkout service', environment: 'Live', prefix: 'wy_live_4f2a', created: '06-12-2025', lastUsed: '2 hours ago', status: 'Active' },
    { id: 'key-2', name: 'Mobile app', environment: 'Live', prefix: 'wy_live_9c3d', created: '02-04-2025', lastUsed: '18 minutes ago', status: 'Active' },
    { id: 'key-3', name: 'Reporting sandbox', environment: 'Test', prefix: 'wy_test_71ab', created: '11-30-2025', lastUsed: '3 days ago', status: 'Active' },
    { id: 'key-4', name: 'Legacy reporting key', environment: 'Live', prefix: 'wy_live_e01f', created: '05-19-2024', lastUsed: '4 months ago', status: 'Revoked' }
  ];

  const apiUsageLabels = ['Sep 25', 'Sep 26', 'Sep 27', 'Sep 28', 'Sep 29', 'Sep 30', 'Oct 1'];
  const apiUsageRequests = [812400, 843200, 798100, 902300, 887600, 934500, 968200];
  const apiUsageErrors = [1.2, 0.9, 1.4, 0.8, 0.6, 0.7, 0.5];

  const positions = [
    { instrument: 'FGN Bond 2031', quantity: '18,000 units', avgCost: '₦1,215.40', marketValue: 21877200, pl: 1284600, plPercent: '6.2%' },
    { instrument: 'Dangote Cement', quantity: '4,200 shares', avgCost: '₦412.80', marketValue: 1978800, pl: 244200, plPercent: '14.1%' },
    { instrument: 'GTCO', quantity: '9,600 shares', avgCost: '₦48.90', marketValue: 456960, pl: -21120, plPercent: '-4.4%' },
    { instrument: 'MTN Nigeria', quantity: '2,800 shares', avgCost: '₦210.35', marketValue: 621880, pl: 33180, plPercent: '5.6%' },
    { instrument: 'Treasury Bill 182D', quantity: '₦5,000,000 face', avgCost: '₦4,742,000', marketValue: 4890500, pl: 148500, plPercent: '3.1%' },
    { instrument: 'Zenith Bank', quantity: '6,100 shares', avgCost: '₦39.60', marketValue: 227530, pl: -14040, plPercent: '-5.8%' }
  ];

  const defaultMembers = [
    ['Adebayo Johnson', 'adebayo.johnson@gmail.com', 'Owner', '10-02-2026 04:00pm', true],
    ['Oyeleye Ogunsanya', 'Oyeleye.o@gmail.com', 'Developer', '10-03-2026 02:30pm', true],
    ['Damilola Adeyemi', 'damilola.a@gmail.com', 'Customer Support', '10-06-2026 10:45am', false],
    ['Chika Okafor', 'chika.o@gmail.com', 'Operations', '10-05-2026 11:00am', true],
    ['Bola Smith', 'bola.smith@gmail.com', 'Admin', '10-04-2026 01:15pm', true],
    ['Emeka Nwosu', 'emeka.nwosu@gmail.com', 'Admin', '10-08-2026 05:15pm', true],
    ['Lola Johnson', 'Lola.j@gmail.com', 'Admin', '10-07-2026 09:30am', false],
    ['Fola Adebayo', 'fola.adebayo@gmail.com', 'Admin', '10-09-2026 06:00pm', false]
  ].map((member, index) => ({ id: `member-${index + 1}`, name: member[0], email: member[1], role: member[2], lastLogin: member[3], twoFactor: member[4] }));

  function loadMembers() {
    try {
      const storedMembers = JSON.parse(localStorage.getItem('settings-team-members-v1'));
      return Array.isArray(storedMembers) ? storedMembers : defaultMembers;
    } catch { return defaultMembers; }
  }

  const transactionState = { query: '', status: 'all', direction: 'all', page: 1, pageSize: 50, selected: new Set(), loading: true, error: false, filterOpen: false };
  const teamState = { query: '', twoFactor: 'all', selected: new Set(), members: loadMembers(), loading: false, filterOpen: false, timer: 0 };
  const usersState = { query: '', status: 'all', page: 1, pageSize: 10, selected: new Set(), loading: true, error: false, filterOpen: false };
  const ordersState = { query: '', status: 'all', type: 'all', page: 1, pageSize: 10, loading: true, error: false, filterOpen: false };
  const auditState = { activity: '', role: '', date: '', page: 1, pageSize: 20, selected: new Set(), loading: true, filterOpen: false, openId: '', copied: '', copyTimer: 0 };
  const apiState = { query: '', loading: true, revealedKeyId: null };
  const homeState = { range: '7', loading: false, rangeOpen: false, timer: 0 };
  const accountState = { query: '', status: 'all', direction: 'all', page: 1, pageSize: 20, selected: new Set(), loading: true, error: false, filterOpen: false, copied: '', copyTimer: 0 };
  const usdAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const reportState = { range: '7', loading: false, rangeOpen: false, timer: 0 };
  const reportRanges = {
    '7': {
      label: 'Last 7 days (Jan 13–19)',
      shortLabels: ['Jan 13', 'Jan 14', 'Jan 15', 'Jan 16', 'Jan 17', 'Jan 18', 'Jan 19'],
      revenue: [21, 24, 22, 27, 29, 31, 36],
      volume: [180, 165, 210, 198, 224, 246, 268],
      settlement: [96.2, 96.8, 95.9, 97.1, 97.4, 97.8, 98.1],
      metrics: [['Total Revenue', '₦284.6M', '15.2%', 'wallet'], ['Trade Volume', '₦1.28B', '8.7%', 'trend'], ['Avg Order Value', '₦211,400', '4.1%', 'basket'], ['Active Traders', '9,842', '6.4%', 'users']]
    },
    '30': {
      label: 'Last 30 days (Aug 2–31)',
      shortLabels: ['Aug 2', 'Aug 7', 'Aug 12', 'Aug 17', 'Aug 22', 'Aug 27', 'Aug 31'],
      revenue: [640, 705, 690, 760, 810, 890, 940],
      volume: [4200, 4550, 4380, 4900, 5150, 5480, 5760],
      settlement: [95.4, 96.1, 96.5, 96.9, 97.2, 97.6, 98.0],
      metrics: [['Total Revenue', '₦1.18B', '20.4%', 'wallet'], ['Trade Volume', '₦5.76B', '14.1%', 'trend'], ['Avg Order Value', '₦204,900', '3.4%', 'basket'], ['Active Traders', '31,204', '11.8%', 'users']]
    },
    '90': {
      label: 'Last 90 days (Jun 3–Aug 31)',
      shortLabels: ['Jun 3', 'Jun 18', 'Jul 3', 'Jul 18', 'Aug 2', 'Aug 17', 'Aug 31'],
      revenue: [1820, 2010, 2240, 2480, 2760, 3040, 3370],
      volume: [11800, 12900, 14200, 15600, 17100, 18700, 20500],
      settlement: [94.6, 95.2, 95.8, 96.4, 97.0, 97.5, 98.1],
      metrics: [['Total Revenue', '₦3.37B', '27.1%', 'wallet'], ['Trade Volume', '₦20.5B', '19.6%', 'trend'], ['Avg Order Value', '₦198,700', '2.9%', 'basket'], ['Active Traders', '68,910', '17.3%', 'users']]
    }
  };
  const homeRanges = {
    '7': {
      label: 'Last 7 days (Jan 13–19)',
      shortLabels: ['Jan 13', 'Jan 14', 'Jan 15', 'Jan 16', 'Jan 17', 'Jan 18', 'Jan 19'],
      users: [190, 135, 135, 390, 390, 480, 920],
      orders: [390, 300, 530, 470, 350, 450, 430, 590, 640, 1180, 1140],
      activation: [42.2, 43.2, 43.5, 45.3, 45.3, 47.7, 49.5],
      metrics: [['Total Users', '824.6K', '12.4%', 'users'], ['Active Users', '394.7K', '8.4%', 'basket'], ['Total Orders', '1.28M', '8.7%', 'orders'], ['Order Value', '$284.6M', '15.2%', 'wallet']]
    },
    '30': {
      label: 'Last 30 days (Aug 2–31)',
      shortLabels: ['Aug 2', 'Aug 7', 'Aug 12', 'Aug 17', 'Aug 22', 'Aug 27', 'Aug 31'],
      users: [520, 610, 680, 790, 890, 1010, 1180],
      orders: [650, 720, 690, 880, 970, 1210, 1380],
      activation: [43.1, 43.8, 44.2, 45.1, 46.3, 48.2, 50.4],
      metrics: [['Total Users', '3.42M', '18.2%', 'users'], ['Active Users', '1.61M', '11.6%', 'basket'], ['Total Orders', '5.76M', '14.1%', 'orders'], ['Order Value', '$1.18B', '20.4%', 'wallet']]
    },
    '90': {
      label: 'Last 90 days (Jun 3–Aug 31)',
      shortLabels: ['Jun 3', 'Jun 18', 'Jul 3', 'Jul 18', 'Aug 2', 'Aug 17', 'Aug 31'],
      users: [710, 840, 960, 1110, 1270, 1460, 1720],
      orders: [920, 990, 1160, 1310, 1490, 1730, 1980],
      activation: [41.6, 42.7, 43.9, 45.2, 47.1, 49.4, 52.2],
      metrics: [['Total Users', '9.84M', '24.8%', 'users'], ['Active Users', '4.68M', '17.3%', 'basket'], ['Total Orders', '16.2M', '19.6%', 'orders'], ['Order Value', '$3.37B', '27.1%', 'wallet']]
    }
  };
  let rowMenu = null;
  let rowMenuTrigger = null;
  let pendingRemoval = null;

  function persistMembers() {
    try { localStorage.setItem('settings-team-members-v1', JSON.stringify(teamState.members)); } catch {}
  }

  function currentRoute() {
    const hash = location.hash.replace(/^#/, '');
    return hash.startsWith('/') ? hash : '/settings';
  }

  function titleForRoute(route) {
    return ({ '/dashboard': 'Home', '/account': 'Account', '/users': 'Users', '/orders': 'Orders', '/api': 'API', '/reports': 'Report', '/business-trading': 'Business trading', '/accounts/new': 'New account', '/audit-log': 'Audit log', '/help': 'Help' })[route] || 'Settings';
  }

  function notify(message, type = 'success', options = {}) {
    return window.productToast?.push({ type, message, ...options });
  }

  function updateNotice(id, next) {
    return window.productToast?.update(id, next);
  }

  function checkboxMarkup(checked, action, id, label) {
    return `<button class="ds-checkbox t-check" type="button" role="checkbox" aria-checked="${checked}" aria-label="${esc(label)}" data-page-action="${action}" ${id ? `data-id="${esc(id)}"` : ''}><svg aria-hidden="true" viewBox="0 0 10.1668 10.1668"><path d="M1 5.52L3.92 9.17L9.17 1"/></svg></button>`;
  }

  function avatarMarkup(name, index) {
    const colors = avatarColors[index % avatarColors.length];
    return `<span class="table-avatar" style="--avatar-bg:${colors[0]};--avatar-fg:${colors[1]};--avatar-bg-dark:${colors[2]};--avatar-fg-dark:${colors[3]}">${esc(name.trim()[0])}</span>`;
  }

  function statusMarkup(status) {
    const key = status.toLowerCase();
    const normalized = key === 'successful' ? 'success' : key;
    const iconName = normalized === 'success' || normalized === 'enabled' ? 'check' : normalized === 'failed' ? 'close' : 'statusAlert';
    const statusIcon = normalized === 'pending'
      ? '<svg class="table-status-hourglass" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 3h10v2c0 2.7-1.3 5.1-3.4 7 2.1 1.9 3.4 4.3 3.4 7v2H7v-2c0-2.7 1.3-5.1 3.4-7C8.3 10.1 7 7.7 7 5V3Z"/></svg>'
      : `<span class="table-status-badge" aria-hidden="true">${icon(iconName)}</span>`;
    return `<span class="table-status" data-status="${normalized}">${statusIcon}<span>${esc(status)}</span></span>`;
  }

  function skeletonMarkup(rows = 8) {
    return `<div class="table-skeleton" aria-label="Loading data">${Array.from({ length: rows }, () => '<div class="table-skeleton-row"><span></span><span></span><span></span><span></span><span></span></div>').join('')}</div>`;
  }

  function emptyMarkup(title, message, action, label = 'Clear filters') {
    return `<div class="data-state"><div class="data-state-content"><span class="data-state-icon">${icon('inbox')}</span><h2>${esc(title)}</h2><p>${esc(message)}</p>${action ? `<button class="page-button" type="button" data-page-action="${action}">${esc(label)}</button>` : ''}</div></div>`;
  }

  function errorMarkup(action) {
    return `<div class="data-state"><div class="data-state-content"><span class="data-state-icon">${icon('deactivate')}</span><h2>We couldn’t load this data</h2><p>The request did not complete. Try again without losing your current filters.</p><button class="page-button" type="button" data-page-action="${action}">${icon('refresh')} Retry</button></div></div>`;
  }

  function filteredTransactions() {
    const query = transactionState.query.trim().toLowerCase();
    return transactions.filter(row => (!query || [row.name, row.source, row.id].join(' ').toLowerCase().includes(query)) && (transactionState.status === 'all' || row.status.toLowerCase() === transactionState.status) && (transactionState.direction === 'all' || row.direction.toLowerCase() === transactionState.direction));
  }

  function transactionFilterMarkup() {
    if (!transactionState.filterOpen) return '';
    const chip = (group, value, label, active) => `<button class="filter-chip" type="button" aria-pressed="${active}" data-page-action="transaction-filter" data-group="${group}" data-value="${value}">${label}</button>`;
    return `<section class="table-filter-panel t-dropdown" data-origin="top-right" aria-label="Transaction filters"><h2>Filter transactions</h2><div class="filter-group"><span>Status</span><div class="filter-options">${['all','successful','pending','failed'].map(value => chip('status', value, value[0].toUpperCase() + value.slice(1), transactionState.status === value)).join('')}</div></div><div class="filter-group"><span>Direction</span><div class="filter-options">${['all','funding','withdrawal'].map(value => chip('direction', value, value[0].toUpperCase() + value.slice(1), transactionState.direction === value)).join('')}</div></div><div class="form-field"><label for="transaction-query">User, bank or transaction ID</label><input id="transaction-query" data-transaction-query value="${esc(transactionState.query)}" placeholder="Search transactions"></div><div class="filter-actions"><button class="page-button" type="button" data-page-action="reset-transaction-filter">Reset</button><button class="page-button primary" type="button" data-page-action="close-transaction-filter">Done</button></div></section>`;
  }

  function transactionHeadingActions() {
    headingActions.innerHTML = `<button class="page-button" type="button" data-page-action="download-transactions">${icon('download')} Download</button><span class="table-filter-wrap"><button class="table-filter-trigger" type="button" data-page-action="toggle-transaction-filter" aria-expanded="${transactionState.filterOpen}">${icon('filter')} Filter</button>${transactionFilterMarkup()}</span>`;
    if (transactionState.filterOpen) requestAnimationFrame(() => headingActions.querySelector('.table-filter-panel')?.classList.add('is-open'));
  }

  function transactionRow(row, index) {
    const selected = transactionState.selected.has(row.id);
    const directionIcon = row.direction === 'Funding' ? 'upRight' : 'downLeft';
    return `<tr class="${selected ? 'is-selected' : ''}"><td class="col-select">${checkboxMarkup(selected, 'select-transaction', row.id, `Select ${row.id}`)}</td><td class="col-name" data-label="User name"><span class="table-person">${avatarMarkup(row.name, index)}<strong>${esc(row.name)}</strong></span></td><td class="col-direction" data-label="Direction"><span class="table-cell-icon">${icon(directionIcon)}<span>${esc(row.direction)}</span></span></td><td class="col-source" data-label="Source"><span class="table-cell-icon">${icon('bank')}<span>${esc(row.source)}</span></span></td><td class="col-status" data-label="Status">${statusMarkup(row.status)}</td><td class="col-amount" data-label="Amount">${new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(row.amount)}</td><td class="col-date" data-label="Date">${esc(row.date)}</td></tr>`;
  }

  function transactionBulkMarkup() {
    if (!transactionState.selected.size) return '';
    return `<div class="bulk-action-bar" role="toolbar" aria-label="${transactionState.selected.size} selected transactions"><button data-page-action="download-selected">${icon('download')} Download Transx</button><button data-page-action="flag-selected">${icon('flag')} Flag Users</button><button data-page-action="freeze-selected">${icon('snow')} Freeze User</button><button data-page-action="deactivate-selected">${icon('deactivate')} Deactivate</button></div>`;
  }

  function paginationMarkup(total) {
    const pages = Math.max(1, Math.ceil(total / transactionState.pageSize));
    transactionState.page = Math.min(transactionState.page, pages);
    return `<div class="table-pagination"><div class="pagination-controls"><button class="pagination-button" data-page-action="transaction-page" data-page="first" ${transactionState.page === 1 ? 'disabled' : ''} aria-label="First page">${icon('doubleLeft')}</button><button class="pagination-button" data-page-action="transaction-page" data-page="previous" ${transactionState.page === 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevronLeft')}</button><span class="pagination-count">${transactionState.page} / ${pages}</span><button class="pagination-button" data-page-action="transaction-page" data-page="next" ${transactionState.page === pages ? 'disabled' : ''} aria-label="Next page">${icon('chevronRight')}</button><button class="pagination-button" data-page-action="transaction-page" data-page="last" ${transactionState.page === pages ? 'disabled' : ''} aria-label="Last page">${icon('doubleRight')}</button></div><label class="page-size-control"><span class="sr-only">Rows per page</span><select data-page-action="transaction-page-size"><option value="10" ${transactionState.pageSize === 10 ? 'selected' : ''}>10 rows</option><option value="25" ${transactionState.pageSize === 25 ? 'selected' : ''}>25 rows</option><option value="50" ${transactionState.pageSize === 50 ? 'selected' : ''}>50 rows</option></select></label></div>`;
  }

  function renderTransactionTable() {
    const host = document.querySelector('#transaction-data');
    if (!host) return;
    if (transactionState.loading) { host.innerHTML = skeletonMarkup(10); return; }
    if (transactionState.error) { host.innerHTML = errorMarkup('retry-transactions'); return; }
    const rows = filteredTransactions();
    if (!rows.length) { host.innerHTML = emptyMarkup('No transactions found', 'Try another search term or clear the selected filters.', 'reset-transaction-filter'); return; }
    const start = (transactionState.page - 1) * transactionState.pageSize;
    const visible = rows.slice(start, start + transactionState.pageSize);
    const allSelected = visible.length > 0 && visible.every(row => transactionState.selected.has(row.id));
    host.innerHTML = `<div class="data-table-scroll transactions-table-scroll"><table class="data-table data-table--transactions"><thead><tr><th class="col-select">${checkboxMarkup(allSelected, 'select-visible-transactions', '', 'Select visible transactions')}</th><th class="col-name">User name</th><th class="col-direction">Direction</th><th class="col-source">Source</th><th class="col-status">Status</th><th class="col-amount">Amount</th><th class="col-date">Date</th></tr></thead><tbody>${visible.map(transactionRow).join('')}</tbody></table></div>${paginationMarkup(rows.length)}${transactionBulkMarkup()}`;
  }

  function renderTransactions() {
    closeRowMenu(false);
    page.classList.add('is-data-page');
    pageTitle.textContent = 'Transactions';
    document.title = 'Transactions · Waya';
    tabs.hidden = true;
    transactionHeadingActions();
    content.innerHTML = '<div class="data-table-shell" id="transaction-data"></div>';
    renderTransactionTable();
    if (transactionState.loading) window.setTimeout(() => { transactionState.loading = false; if (currentRoute() === '/transactions') renderTransactionTable(); }, dataDelay);
  }

  function filteredAccountTransactions() {
    const query = accountState.query.trim().toLowerCase();
    return accountTransactions.filter(row => (!query || [row.counterparty, row.id, row.direction, row.status].join(' ').toLowerCase().includes(query)) && (accountState.status === 'all' || row.status.toLowerCase() === accountState.status) && (accountState.direction === 'all' || row.direction.toLowerCase() === accountState.direction));
  }

  function accountFilterMarkup() {
    if (!accountState.filterOpen) return '';
    const chip = (group, value) => `<button class="filter-chip" type="button" aria-pressed="${accountState[group] === value}" data-page-action="account-filter" data-group="${group}" data-value="${value}">${value[0].toUpperCase() + value.slice(1)}</button>`;
    return `<section class="table-filter-panel t-dropdown" data-origin="top-left" aria-label="Account transaction filters"><h2>Filter transactions</h2><div class="filter-group"><span>Status</span><div class="filter-options">${['all','successful','pending','failed'].map(value => chip('status', value)).join('')}</div></div><div class="filter-group"><span>Direction</span><div class="filter-options">${['all','funding','withdrawal'].map(value => chip('direction', value)).join('')}</div></div><div class="filter-actions"><button class="page-button" type="button" data-page-action="reset-account-filter">Reset</button><button class="page-button primary" type="button" data-page-action="close-account-filter">Done</button></div></section>`;
  }

  function renderAccountFilter() {
    const wrap = document.querySelector('.account-toolbar .table-filter-wrap');
    if (!wrap) return;
    wrap.innerHTML = `<button class="table-filter-trigger" type="button" data-page-action="toggle-account-filter" aria-expanded="${accountState.filterOpen}">${icon('filter')} Filter</button>${accountFilterMarkup()}`;
    if (accountState.filterOpen) requestAnimationFrame(() => wrap.querySelector('.table-filter-panel')?.classList.add('is-open'));
  }

  function accountCopyMarkup(label, value) {
    const copied = accountState.copied === label;
    const mark = copied ? `<span class="table-status-badge" aria-hidden="true">${icon('check')}</span>` : icon('copy');
    return `<button class="account-copy${copied ? ' is-copied' : ''}" type="button" data-page-action="copy-account-detail" data-label="${esc(label)}" data-value="${esc(value)}" aria-label="${copied ? `${esc(label)} copied` : `Copy ${esc(label.toLowerCase())}`}">${mark}</button>`;
  }

  function accountDetailsMarkup() {
    const rows = accountProfile.details.map(([label, value]) => `<div class="account-detail"><div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>${accountCopyMarkup(label, value)}</div>`).join('');
    return `<span class="account-details-mark" aria-hidden="true">${icon('bank')}</span><h2 id="account-details-title">Account details</h2><p class="account-details-lede">Make a transfer to the account number</p><dl class="account-detail-list">${rows}</dl><button class="page-button account-copy-all" type="button" data-page-action="copy-account-details">Copy all details ${icon('copy')}</button>`;
  }

  function renderAccountDetails() {
    const host = document.querySelector('#account-details');
    if (host) host.innerHTML = accountDetailsMarkup();
  }

  function accountDetailText() {
    return accountProfile.details.map(([label, value]) => `${label}: ${value}`).join('\n');
  }

  function copyAccountValue(label, value, message) {
    if (!navigator.clipboard?.writeText) return notify('This browser blocked clipboard access. Select the value and copy it manually.', 'error', { title: 'Copy unavailable' });
    navigator.clipboard.writeText(value).then(() => {
      accountState.copied = label;
      renderAccountDetails();
      notify(message, 'success', { title: 'Copied to clipboard' });
      clearTimeout(accountState.copyTimer);
      accountState.copyTimer = window.setTimeout(() => { accountState.copied = ''; if (currentRoute() === '/account') renderAccountDetails(); }, 1600);
    }, () => notify('The value could not be copied. Select it and copy manually.', 'error', { title: 'Copy failed' }));
  }

  function accountRow(row) {
    const selected = accountState.selected.has(row.id);
    const directionIcon = row.direction === 'Funding' ? 'upRight' : 'downLeft';
    return `<tr class="${selected ? 'is-selected' : ''}"><td class="col-select">${checkboxMarkup(selected, 'select-account-transaction', row.id, `Select ${row.id}`)}</td><td class="col-direction" data-label="Direction"><span class="table-cell-icon">${icon(directionIcon)}<span>${esc(row.direction)}</span></span></td><td class="col-counterparty" data-label="From / To"><span class="table-cell-icon">${icon('bank')}<span>${esc(row.counterparty)}</span></span></td><td class="col-status" data-label="Status">${statusMarkup(row.status)}</td><td class="col-date" data-label="Date">${esc(row.date)}</td><td class="col-amount" data-label="Amount">${usdAmount.format(row.amount)}</td></tr>`;
  }

  function accountPaginationMarkup(total) {
    const pages = Math.max(1, Math.ceil(total / accountState.pageSize));
    accountState.page = Math.min(accountState.page, pages);
    const step = (value, label, iconName, disabled) => `<button class="pagination-button" data-page-action="account-page" data-page="${value}" ${disabled ? 'disabled' : ''} aria-label="${label}">${icon(iconName)}</button>`;
    return `<div class="table-pagination"><div class="pagination-controls">${step('first', 'First page', 'doubleLeft', accountState.page === 1)}${step('previous', 'Previous page', 'chevronLeft', accountState.page === 1)}<span class="pagination-count">${accountState.page} / ${pages}</span>${step('next', 'Next page', 'chevronRight', accountState.page === pages)}${step('last', 'Last page', 'doubleRight', accountState.page === pages)}</div><label class="page-size-control"><span class="sr-only">Rows per page</span><select data-page-action="account-page-size">${[10, 20, 50].map(size => `<option value="${size}" ${accountState.pageSize === size ? 'selected' : ''}>${size} rows</option>`).join('')}</select></label></div>`;
  }

  function accountBulkMarkup() {
    if (!accountState.selected.size) return '';
    return `<div class="bulk-action-bar" role="toolbar" aria-label="${accountState.selected.size} selected transactions"><button data-page-action="download-selected-account">${icon('download')} Download selected</button><button data-page-action="clear-account-selection">${icon('close')} Clear selection</button></div>`;
  }

  function renderAccountTable() {
    const host = document.querySelector('#account-data');
    if (!host) return;
    if (accountState.loading) { host.innerHTML = skeletonMarkup(10); return; }
    if (accountState.error) { host.innerHTML = errorMarkup('retry-account'); return; }
    const rows = filteredAccountTransactions();
    if (!rows.length) { host.innerHTML = emptyMarkup('No transactions found', 'Try another search term or clear the selected filters.', 'reset-account-filter'); return; }
    const start = (accountState.page - 1) * accountState.pageSize;
    const visible = rows.slice(start, start + accountState.pageSize);
    const allSelected = visible.length > 0 && visible.every(row => accountState.selected.has(row.id));
    host.innerHTML = `<div class="data-table-scroll account-table-scroll"><table class="data-table data-table--account"><thead><tr><th class="col-select">${checkboxMarkup(allSelected, 'select-visible-account-transactions', '', 'Select visible transactions')}</th><th class="col-direction">Direction</th><th class="col-counterparty">From / To</th><th class="col-status">Status</th><th class="col-date">Date</th><th class="col-amount">Amount</th></tr></thead><tbody>${visible.map(accountRow).join('')}</tbody></table></div>${accountPaginationMarkup(rows.length)}${accountBulkMarkup()}`;
  }

  function changeAccountPage(step) {
    const pages = Math.max(1, Math.ceil(filteredAccountTransactions().length / accountState.pageSize));
    if (step === 'first') accountState.page = 1;
    if (step === 'previous') accountState.page = Math.max(1, accountState.page - 1);
    if (step === 'next') accountState.page = Math.min(pages, accountState.page + 1);
    if (step === 'last') accountState.page = pages;
    accountState.loading = true;
    renderAccountTable();
    window.setTimeout(() => { accountState.loading = false; renderAccountTable(); }, 300);
  }

  function renderAccount() {
    closeRowMenu(false);
    page.classList.add('is-data-page');
    pageTitle.textContent = 'Account';
    document.title = 'Account · Waya';
    tabs.hidden = true;
    headingActions.innerHTML = '';
    const balance = `<section class="account-balance" aria-label="Account balance"><div class="account-balance-value"><span class="account-balance-label">Balance</span><strong class="account-balance-amount">${usdAmount.format(accountProfile.balance)}</strong></div><button class="account-refresh" type="button" data-page-action="refresh-balance" data-tooltip="Refresh balance" aria-label="Refresh balance">${icon('refresh')}</button></section>`;
    const toolbar = `<div class="account-toolbar"><div class="account-toolbar-left"><label class="table-search">${icon('search')}<input type="search" data-account-query value="${esc(accountState.query)}" placeholder="Search transactions" aria-label="Search transactions"></label><span class="table-filter-wrap"><button class="table-filter-trigger" type="button" data-page-action="toggle-account-filter" aria-expanded="${accountState.filterOpen}">${icon('filter')} Filter</button>${accountFilterMarkup()}</span></div><button class="page-button" type="button" data-page-action="download-account">${icon('download')} Download</button></div>`;
    content.innerHTML = `<div class="account-layout"><div class="account-main">${balance}${toolbar}<div class="data-table-shell" id="account-data"></div></div><aside class="account-details" id="account-details" aria-labelledby="account-details-title">${accountDetailsMarkup()}</aside></div>`;
    renderAccountTable();
    if (accountState.loading) window.setTimeout(() => { accountState.loading = false; if (currentRoute() === '/account') renderAccountTable(); }, dataDelay);
  }

  function teamToolbarMarkup() {
    return `<div class="team-toolbar"><div class="team-toolbar-left"><label class="table-search">${icon('search')}<input type="search" data-team-search value="${esc(teamState.query)}" placeholder="Search members" aria-label="Search members"></label><span class="table-filter-wrap"><button class="table-filter-trigger" type="button" data-page-action="toggle-team-filter" aria-expanded="${teamState.filterOpen}">${icon('filter')} Filter</button>${teamFilterMarkup()}</span></div><div class="team-toolbar-right"><button class="page-button" type="button" data-page-action="enforce-two-factor">${icon('shield')} Enforce 2FA</button><button class="page-button" type="button" data-page-action="manage-roles">${icon('card')} Manage roles</button><button class="page-button primary" type="button" data-page-action="invite-member">${icon('plus')} Invite member</button></div></div>`;
  }

  function teamFilterMarkup() {
    if (!teamState.filterOpen) return '';
    return `<section class="table-filter-panel t-dropdown" data-origin="top-left" aria-label="Member filters"><h2>Filter members</h2><div class="filter-group"><span>2FA status</span><div class="filter-options">${['all','enabled','disabled'].map(value => `<button class="filter-chip" type="button" aria-pressed="${teamState.twoFactor === value}" data-page-action="team-filter" data-value="${value}">${value[0].toUpperCase() + value.slice(1)}</button>`).join('')}</div></div><div class="filter-actions"><button class="page-button" type="button" data-page-action="reset-team-filter">Reset</button><button class="page-button primary" type="button" data-page-action="close-team-filter">Done</button></div></section>`;
  }

  function filteredMembers() {
    const query = teamState.query.trim().toLowerCase();
    return teamState.members.filter(member => (!query || [member.name, member.email, member.role].join(' ').toLowerCase().includes(query)) && (teamState.twoFactor === 'all' || (member.twoFactor ? 'enabled' : 'disabled') === teamState.twoFactor));
  }

  function memberRow(member, index) {
    const selected = teamState.selected.has(member.id);
    return `<tr class="${selected ? 'is-selected' : ''}"><td class="col-select">${checkboxMarkup(selected, 'select-member', member.id, `Select ${member.name}`)}</td><td class="col-name" data-label="Name"><span class="table-person">${avatarMarkup(member.name, index)}<strong>${esc(member.name)}</strong></span></td><td class="col-email" data-label="Email">${esc(member.email)}</td><td class="col-role" data-label="Role"><span class="table-cell-icon">${icon('shield')}<span>${esc(member.role)}</span></span></td><td class="col-login" data-label="Last login">${esc(member.lastLogin)}</td><td class="col-twofa" data-label="2FA status">${statusMarkup(member.twoFactor ? 'Enabled' : 'Disabled')}</td><td class="col-actions" data-label="Action"><button class="row-menu-trigger" type="button" data-page-action="member-menu" data-id="${member.id}" aria-label="Actions for ${esc(member.name)}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button></td></tr>`;
  }

  function renderTeamRows() {
    closeRowMenu(false);
    const host = document.querySelector('#team-data');
    if (!host) return;
    if (teamState.loading) { host.innerHTML = skeletonMarkup(7); return; }
    const members = filteredMembers();
    if (!members.length) { host.innerHTML = emptyMarkup('No members found', 'Try another search term or clear the selected member filter.', 'reset-team-filter'); return; }
    const allSelected = members.every(member => teamState.selected.has(member.id));
    host.innerHTML = `<div class="data-table-scroll"><table class="data-table data-table--team"><thead><tr><th class="col-select">${checkboxMarkup(allSelected, 'select-visible-members', '', 'Select visible members')}</th><th class="col-name">Name</th><th class="col-email">Email</th><th class="col-role">Role</th><th class="col-login">Last Login</th><th class="col-twofa">2FA Status</th><th class="col-actions">Action</th></tr></thead><tbody>${members.map(memberRow).join('')}</tbody></table></div>`;
  }

  function teamMarkup() {
    return `<div role="tabpanel" id="team-panel">${teamToolbarMarkup()}<div class="data-table-shell" id="team-data"></div></div>`;
  }

  function renderTeam() {
    content.innerHTML = teamMarkup();
    if (teamState.filterOpen) requestAnimationFrame(() => content.querySelector('.table-filter-panel')?.classList.add('is-open'));
    renderTeamRows();
  }

  function genericPaginationMarkup(pageState, total, actionName, sizes = [10, 25, 50]) {
    const pages = Math.max(1, Math.ceil(total / pageState.pageSize));
    pageState.page = Math.min(pageState.page, pages);
    return `<div class="table-pagination"><div class="pagination-controls"><button class="pagination-button" data-page-action="${actionName}" data-page="first" ${pageState.page === 1 ? 'disabled' : ''} aria-label="First page">${icon('doubleLeft')}</button><button class="pagination-button" data-page-action="${actionName}" data-page="previous" ${pageState.page === 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevronLeft')}</button><span class="pagination-count">${pageState.page} / ${pages}</span><button class="pagination-button" data-page-action="${actionName}" data-page="next" ${pageState.page === pages ? 'disabled' : ''} aria-label="Next page">${icon('chevronRight')}</button><button class="pagination-button" data-page-action="${actionName}" data-page="last" ${pageState.page === pages ? 'disabled' : ''} aria-label="Last page">${icon('doubleRight')}</button></div><label class="page-size-control"><span class="sr-only">Rows per page</span><select data-page-action="${actionName}-size">${sizes.map(size => `<option value="${size}" ${pageState.pageSize === size ? 'selected' : ''}>${size} rows</option>`).join('')}</select></label></div>`;
  }

  function changeGenericPage(pageState, total, action) {
    const pages = Math.max(1, Math.ceil(total / pageState.pageSize));
    if (action === 'first') pageState.page = 1;
    if (action === 'previous') pageState.page = Math.max(1, pageState.page - 1);
    if (action === 'next') pageState.page = Math.min(pages, pageState.page + 1);
    if (action === 'last') pageState.page = pages;
  }

  function openActionMenu(trigger, ariaLabel, itemsHtml) {
    closeRowMenu(false);
    rowMenuTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    rowMenu = document.createElement('div');
    rowMenu.className = 'table-row-menu t-dropdown';
    rowMenu.dataset.origin = 'top-right';
    rowMenu.setAttribute('role', 'menu');
    rowMenu.setAttribute('aria-label', ariaLabel);
    rowMenu.innerHTML = itemsHtml;
    document.body.append(rowMenu);
    const rect = trigger.getBoundingClientRect();
    const top = rect.bottom + 5 + rowMenu.offsetHeight > innerHeight - 12 ? rect.top - rowMenu.offsetHeight - 5 : rect.bottom + 5;
    rowMenu.style.left = `${Math.min(innerWidth - rowMenu.offsetWidth - 12, Math.max(12, rect.right - rowMenu.offsetWidth))}px`;
    rowMenu.style.top = `${Math.max(12, top)}px`;
    requestAnimationFrame(() => rowMenu?.classList.add('is-open'));
  }

  function openUserMenu(trigger, user) {
    openActionMenu(trigger, `Actions for ${user.name}`, `<button role="menuitem" data-user-action="view" data-id="${user.id}">${icon('users')}<span>View profile</span></button><button role="menuitem" data-user-action="reset" data-id="${user.id}">${icon('key')}<span>Reset password</span></button><div class="menu-divider"></div><button role="menuitem" data-user-action="tier" data-id="${user.id}">${icon('card')}<span>Change tier</span></button><button role="menuitem" data-user-action="toggle-status" data-id="${user.id}">${icon(user.status === 'Suspended' ? 'refresh' : 'deactivate')}<span>${user.status === 'Suspended' ? 'Reactivate user' : 'Suspend user'}</span></button><div class="menu-divider"></div><button role="menuitem" data-user-action="remove" data-id="${user.id}" data-danger>${icon('trash')}<span>Remove user</span></button>`);
  }

  function openApiKeyMenu(trigger, key) {
    openActionMenu(trigger, `Actions for ${key.name}`, `<button role="menuitem" data-api-action="copy" data-id="${key.id}">${icon('copy')}<span>Copy key</span></button><button role="menuitem" data-api-action="roll" data-id="${key.id}">${icon('refresh')}<span>Roll key</span></button><div class="menu-divider"></div><button role="menuitem" data-api-action="revoke" data-id="${key.id}" data-danger>${icon('trash')}<span>Revoke key</span></button>`);
  }

  function filteredUsers() {
    const query = usersState.query.trim().toLowerCase();
    return users.filter(user => (!query || [user.name, user.email, user.id].join(' ').toLowerCase().includes(query)) && (usersState.status === 'all' || user.status.toLowerCase() === usersState.status));
  }

  function usersFilterMarkup() {
    if (!usersState.filterOpen) return '';
    return `<section class="table-filter-panel t-dropdown" data-origin="top-right" aria-label="User filters"><h2>Filter users</h2><div class="filter-group"><span>Status</span><div class="filter-options">${['all', 'active', 'pending', 'suspended'].map(value => `<button class="filter-chip" type="button" aria-pressed="${usersState.status === value}" data-page-action="users-filter" data-value="${value}">${value[0].toUpperCase() + value.slice(1)}</button>`).join('')}</div></div><div class="form-field t-input-wrap"><label for="users-query">Name, email or user ID</label><input id="users-query" data-users-query value="${esc(usersState.query)}" placeholder="Search users"></div><div class="filter-actions"><button class="page-button" type="button" data-page-action="reset-users-filter">Reset</button><button class="page-button primary" type="button" data-page-action="close-users-filter">Done</button></div></section>`;
  }

  function usersHeadingActions() {
    headingActions.innerHTML = `<button class="page-button" type="button" data-page-action="download-users">${icon('download')} Download</button><span class="table-filter-wrap"><button class="table-filter-trigger" type="button" data-page-action="toggle-users-filter" aria-expanded="${usersState.filterOpen}">${icon('filter')} Filter</button>${usersFilterMarkup()}</span>`;
    if (usersState.filterOpen) requestAnimationFrame(() => headingActions.querySelector('.table-filter-panel')?.classList.add('is-open'));
  }

  function userRow(user, index) {
    const selected = usersState.selected.has(user.id);
    return `<tr class="${selected ? 'is-selected' : ''}"><td class="col-select">${checkboxMarkup(selected, 'select-user', user.id, `Select ${user.name}`)}</td><td class="col-name" data-label="Name"><span class="table-person">${avatarMarkup(user.name, index)}<strong>${esc(user.name)}</strong></span></td><td class="col-email" data-label="Email">${esc(user.email)}</td><td class="col-role" data-label="Plan"><span class="table-cell-icon">${icon('card')}<span>${esc(user.tier)}</span></span></td><td class="col-status" data-label="Status">${statusMarkup(user.status)}</td><td class="col-login" data-label="Orders">${esc(String(user.orders))}</td><td class="col-date" data-label="Joined">${esc(user.joined)}</td><td class="col-actions" data-label="Action"><button class="row-menu-trigger" type="button" data-page-action="user-menu" data-id="${user.id}" aria-label="Actions for ${esc(user.name)}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button></td></tr>`;
  }

  function usersBulkMarkup() {
    if (!usersState.selected.size) return '';
    return `<div class="bulk-action-bar" role="toolbar" aria-label="${usersState.selected.size} selected users"><button data-page-action="flag-selected-users">${icon('flag')} Flag users</button><button data-page-action="freeze-selected-users">${icon('snow')} Freeze users</button><button data-page-action="deactivate-selected-users">${icon('deactivate')} Deactivate</button></div>`;
  }

  function renderUsersTable() {
    const host = document.querySelector('#users-data');
    if (!host) return;
    if (usersState.loading) { host.innerHTML = skeletonMarkup(8); return; }
    if (usersState.error) { host.innerHTML = errorMarkup('retry-users'); return; }
    const rows = filteredUsers();
    if (!rows.length) { host.innerHTML = emptyMarkup('No users found', 'Try another search term or clear the selected filters.', 'reset-users-filter'); return; }
    const start = (usersState.page - 1) * usersState.pageSize;
    const visible = rows.slice(start, start + usersState.pageSize);
    const allSelected = visible.length > 0 && visible.every(row => usersState.selected.has(row.id));
    host.innerHTML = `<div class="data-table-scroll"><table class="data-table data-table--users"><thead><tr><th class="col-select">${checkboxMarkup(allSelected, 'select-visible-users', '', 'Select visible users')}</th><th class="col-name">Name</th><th class="col-email">Email</th><th class="col-role">Plan</th><th class="col-status">Status</th><th class="col-login">Orders</th><th class="col-date">Joined</th><th class="col-actions">Action</th></tr></thead><tbody>${visible.map(userRow).join('')}</tbody></table></div>${genericPaginationMarkup(usersState, rows.length, 'users-page')}${usersBulkMarkup()}`;
  }

  function renderUsers() {
    closeRowMenu(false);
    page.classList.add('is-data-page');
    pageTitle.textContent = 'Users';
    document.title = 'Users · Waya';
    tabs.hidden = true;
    usersHeadingActions();
    content.innerHTML = '<div class="data-table-shell" id="users-data"></div>';
    renderUsersTable();
    if (usersState.loading) window.setTimeout(() => { usersState.loading = false; if (currentRoute() === '/users') renderUsersTable(); }, dataDelay);
  }

  function userProfileModal(user) {
    modal(user.name, user.email, `<div class="member-selection-note"><strong>${esc(user.tier)} plan</strong><br>${esc(String(user.orders))} orders placed · Member since ${esc(user.joined)} · Status: ${esc(user.status)}</div>`, `<button class="button" data-action="close">Done</button>`);
  }

  function changeTierModal(user) {
    modal('Change tier', `Update ${user.name}’s account tier.`, `<form id="change-tier-form" data-user-id="${user.id}"><div class="form-field t-input-wrap"><label for="user-tier">Plan</label><select class="t-input" id="user-tier" required>${['Starter', 'Business', 'Enterprise'].map(tier => `<option ${tier === user.tier ? 'selected' : ''}>${tier}</option>`).join('')}</select><small class="error-message t-error-msg"></small></div></form>`, `<button class="button secondary" data-action="close">Cancel</button><button class="button" form="change-tier-form">Update tier</button>`);
  }

  // ---------- Orders ----------

  function filteredOrders() {
    const query = ordersState.query.trim().toLowerCase();
    return orders.filter(order => (!query || [order.name, order.instrument, order.id].join(' ').toLowerCase().includes(query)) && (ordersState.status === 'all' || order.status.toLowerCase() === ordersState.status) && (ordersState.type === 'all' || order.type.toLowerCase() === ordersState.type));
  }

  function ordersFilterMarkup() {
    if (!ordersState.filterOpen) return '';
    const chip = (group, value, label, active) => `<button class="filter-chip" type="button" aria-pressed="${active}" data-page-action="orders-filter" data-group="${group}" data-value="${value}">${label}</button>`;
    return `<section class="table-filter-panel t-dropdown" data-origin="top-right" aria-label="Order filters"><h2>Filter orders</h2><div class="filter-group"><span>Status</span><div class="filter-options">${['all', 'successful', 'pending', 'failed'].map(value => chip('status', value, value[0].toUpperCase() + value.slice(1), ordersState.status === value)).join('')}</div></div><div class="filter-group"><span>Type</span><div class="filter-options">${['all', 'buy', 'sell'].map(value => chip('type', value, value[0].toUpperCase() + value.slice(1), ordersState.type === value)).join('')}</div></div><div class="form-field t-input-wrap"><label for="orders-query">Customer, instrument or order ID</label><input id="orders-query" data-orders-query value="${esc(ordersState.query)}" placeholder="Search orders"></div><div class="filter-actions"><button class="page-button" type="button" data-page-action="reset-orders-filter">Reset</button><button class="page-button primary" type="button" data-page-action="close-orders-filter">Done</button></div></section>`;
  }

  function ordersHeadingActions() {
    headingActions.innerHTML = `<button class="page-button" type="button" data-page-action="download-orders">${icon('download')} Download</button><span class="table-filter-wrap"><button class="table-filter-trigger" type="button" data-page-action="toggle-orders-filter" aria-expanded="${ordersState.filterOpen}">${icon('filter')} Filter</button>${ordersFilterMarkup()}</span>`;
    if (ordersState.filterOpen) requestAnimationFrame(() => headingActions.querySelector('.table-filter-panel')?.classList.add('is-open'));
  }

  function orderRow(row, index) {
    const typeIcon = row.type === 'Buy' ? 'downLeft' : 'upRight';
    return `<tr><td class="col-name" data-label="Customer"><span class="table-person">${avatarMarkup(row.name, index)}<strong>${esc(row.name)}</strong></span></td><td class="col-direction" data-label="Type"><span class="table-cell-icon">${icon(typeIcon)}<span>${esc(row.type)}</span></span></td><td class="col-source" data-label="Instrument"><span class="table-cell-icon">${icon('trend')}<span>${esc(row.instrument)}</span></span></td><td class="col-status" data-label="Status">${statusMarkup(row.status)}</td><td class="col-amount" data-label="Amount">${new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(row.amount)}</td><td class="col-date" data-label="Date">${esc(row.date)}</td></tr>`;
  }

  function renderOrdersTable() {
    const host = document.querySelector('#orders-data');
    if (!host) return;
    if (ordersState.loading) { host.innerHTML = skeletonMarkup(8); return; }
    if (ordersState.error) { host.innerHTML = errorMarkup('retry-orders'); return; }
    const rows = filteredOrders();
    if (!rows.length) { host.innerHTML = emptyMarkup('No orders found', 'Try another search term or clear the selected filters.', 'reset-orders-filter'); return; }
    const start = (ordersState.page - 1) * ordersState.pageSize;
    const visible = rows.slice(start, start + ordersState.pageSize);
    host.innerHTML = `<div class="data-table-scroll"><table class="data-table data-table--orders"><thead><tr><th class="col-name">Customer</th><th class="col-direction">Type</th><th class="col-source">Instrument</th><th class="col-status">Status</th><th class="col-amount">Amount</th><th class="col-date">Date</th></tr></thead><tbody>${visible.map(orderRow).join('')}</tbody></table></div>${genericPaginationMarkup(ordersState, rows.length, 'orders-page')}`;
  }

  function renderOrders() {
    closeRowMenu(false);
    page.classList.add('is-data-page');
    pageTitle.textContent = 'Orders';
    document.title = 'Orders · Waya';
    tabs.hidden = true;
    ordersHeadingActions();
    content.innerHTML = '<div class="data-table-shell" id="orders-data"></div>';
    renderOrdersTable();
    if (ordersState.loading) window.setTimeout(() => { ordersState.loading = false; if (currentRoute() === '/orders') renderOrdersTable(); }, dataDelay);
  }

  // ---------- Audit log ----------

  const auditDateWindows = { 'Last 24 hours': 864e5, 'Last 7 days': 6048e5, 'Last 30 days': 2592e6 };

  function filteredAudit() {
    const newest = auditLog[0].at;
    return auditLog.filter(entry => {
      if (auditState.activity && entry.verb !== auditState.activity) return false;
      if (auditState.role && entry.role !== auditState.role) return false;
      if (auditState.date && newest - entry.at > auditDateWindows[auditState.date]) return false;
      return true;
    });
  }

  function auditFiltersActive() {
    return Boolean(auditState.activity || auditState.role || auditState.date);
  }

  // The row is revealed by the Filter control, and stays revealed while a
  // filter is applied so an active filter is never hidden from view.
  function resetAuditFilters() {
    auditState.activity = '';
    auditState.role = '';
    auditState.date = '';
    auditState.page = 1;
    auditHeadingActions();
    renderAuditAppliedFilters();
    renderAuditTable();
  }

  function auditActiveCount() {
    return ['activity', 'role', 'date'].filter(key => auditState[key]).length;
  }

  function auditNoticeMarkup() {
    return `<div class="page-notice" data-tone="info"><span class="page-notice-icon" aria-hidden="true">${icon('info')}</span><p>Audit logs are retained for a maximum of 30 days before they are automatically deleted.</p><button class="page-notice-action" type="button" data-page-action="download-audit-window">Download last 30 days</button></div>`;
  }

  function auditHeadingActions() {
    const count = auditActiveCount();
    const badge = count ? `<span class="audit-filter-count">${count}</span>` : '';
    headingActions.innerHTML = `<span class="table-filter-wrap"><button class="table-filter-trigger" type="button" data-page-action="toggle-audit-filter" aria-expanded="${auditState.filterOpen}" aria-controls="audit-filter-panel">${icon('filter')} Filter${badge}</button>${auditFilterMarkup()}</span><button class="page-button" type="button" data-page-action="download-audit">${icon('download')} Download</button>`;
    if (auditState.filterOpen) requestAnimationFrame(() => headingActions.querySelector('.table-filter-panel')?.classList.add('is-open'));
  }

  function auditFilterMarkup() {
    if (!auditState.filterOpen) return '';
    const option = (group, value, label = value || 'All') => `<button class="filter-chip" type="button" aria-pressed="${auditState[group] === value}" data-page-action="audit-filter" data-group="${group}" data-value="${esc(value)}">${esc(label)}</button>`;
    const activities = ['', ...Object.keys(auditVerbs)].map(value => option('activity', value)).join('');
    const roles = ['', ...new Set(auditActors.map(actor => actor[2]))].map(value => option('role', value)).join('');
    const dates = ['', ...Object.keys(auditDateWindows)].map(value => option('date', value)).join('');
    return `<section class="table-filter-panel audit-filter-panel t-dropdown" id="audit-filter-panel" data-origin="top-right" aria-label="Audit log filters"><h2>Filter audit log</h2><div class="filter-group"><span>Activity</span><div class="filter-options">${activities}</div></div><div class="filter-group"><span>Role</span><div class="filter-options">${roles}</div></div><div class="filter-group"><span>Date</span><div class="filter-options">${dates}</div></div><div class="filter-actions"><button class="page-button" type="button" data-page-action="reset-audit-filter">Reset</button><button class="page-button primary" type="button" data-page-action="close-audit-filter">Done</button></div></section>`;
  }

  function auditAppliedFiltersMarkup() {
    const labels = { activity: 'Activity', role: 'Role', date: 'Date' };
    const active = Object.keys(labels).filter(key => auditState[key]);
    if (!active.length) return '';
    const items = active.map(key => `<span class="audit-applied-filter"><span class="audit-applied-label">${labels[key]}</span><span class="audit-applied-value"><span>${esc(auditState[key])}</span><button type="button" data-page-action="remove-audit-filter" data-group="${key}" aria-label="Remove ${labels[key].toLowerCase()} filter">${icon('close')}</button></span></span>`).join('');
    return `<div class="audit-applied-filters-list" role="group" aria-label="Applied audit filters">${items}<button class="audit-clear-filters" type="button" data-page-action="reset-audit-filter">Clear filter</button></div>`;
  }

  function renderAuditAppliedFilters() {
    const host = document.querySelector('#audit-applied-filters');
    if (host) host.innerHTML = auditAppliedFiltersMarkup();
  }

  function auditVerbMarkup(verb) {
    return `<span class="audit-verb" data-tone="${auditVerbs[verb] || 'info'}">${icon('diamond')}<span>${esc(verb)}</span></span>`;
  }

  function auditRow(entry) {
    const selected = auditState.selected.has(entry.id);
    const classes = `${selected ? 'is-selected' : ''}${auditState.openId === entry.id ? ' is-active' : ''}`.trim();
    return `<tr class="${classes}" data-audit-id="${entry.id}"><td class="col-select">${checkboxMarkup(selected, 'select-audit', entry.id, `Select ${entry.id}`)}</td><td class="col-datetime" data-label="Date / Time"><button class="audit-open" type="button" data-page-action="open-audit" data-id="${entry.id}" aria-label="View details: ${esc(entry.title)} by ${esc(entry.actorName)}, ${esc(entry.date)}">${esc(entry.date)}</button></td><td class="col-activity" data-label="Activity"><span class="audit-activity"><strong>${esc(entry.actor)}</strong>${auditVerbMarkup(entry.verb)}<span class="audit-object">${esc(entry.object)}</span></span></td><td class="col-target" data-label="Target"><button class="audit-target" type="button" data-page-action="open-audit-target" data-id="${entry.id}">${esc(entry.target.label)}</button></td><td class="col-role" data-label="Role"><span class="table-cell-icon">${icon('shield')}<span>${esc(entry.role)}</span></span></td></tr>`;
  }

  function auditBulkMarkup() {
    if (!auditState.selected.size) return '';
    return `<div class="bulk-action-bar" role="toolbar" aria-label="${auditState.selected.size} selected events"><button data-page-action="download-selected-audit">${icon('download')} Download selected</button><button data-page-action="clear-audit-selection">${icon('close')} Clear selection</button></div>`;
  }

  function renderAuditTable() {
    const host = document.querySelector('#audit-data');
    if (!host) return;
    if (auditState.loading) { host.innerHTML = skeletonMarkup(10); return; }
    const rows = filteredAudit();
    if (!rows.length) { host.innerHTML = emptyMarkup('No activity found', 'No events match the selected filters.', 'reset-audit-filter'); return; }
    const start = (auditState.page - 1) * auditState.pageSize;
    const visible = rows.slice(start, start + auditState.pageSize);
    const allSelected = visible.length > 0 && visible.every(entry => auditState.selected.has(entry.id));
    host.innerHTML = `<div class="data-table-scroll audit-table-scroll"><table class="data-table data-table--audit"><thead><tr><th class="col-select">${checkboxMarkup(allSelected, 'select-visible-audit', '', 'Select visible events')}</th><th class="col-datetime">Date / Time</th><th class="col-activity">Activity</th><th class="col-target">Target</th><th class="col-role">Role</th></tr></thead><tbody>${visible.map(auditRow).join('')}</tbody></table></div>${genericPaginationMarkup(auditState, rows.length, 'audit-page', [10, 20, 50])}${auditBulkMarkup()}`;
  }

  function renderAuditLog() {
    closeRowMenu(false);
    page.classList.add('is-data-page');
    pageTitle.textContent = 'Audit log';
    document.title = 'Audit log · Waya';
    tabs.hidden = true;
    pageNotice.innerHTML = auditNoticeMarkup();
    auditHeadingActions();
    content.innerHTML = `<div class="audit-applied-filters" id="audit-applied-filters"></div><div class="data-table-shell" id="audit-data"></div>`;
    renderAuditAppliedFilters();
    renderAuditTable();
    if (auditState.loading) window.setTimeout(() => { auditState.loading = false; if (currentRoute() === '/audit-log') renderAuditTable(); }, dataDelay);
  }

  // ---------- Audit event drawer ----------

  function auditStatusMarkup(status) {
    const tone = status === 'Success' ? 'success' : 'failed';
    return `<span class="table-status" data-status="${tone}"><span class="table-status-badge" aria-hidden="true">${icon(tone === 'success' ? 'check' : 'close')}</span><span>${esc(status)}</span></span>`;
  }

  function copyAuditValue(label, value) {
    if (!navigator.clipboard?.writeText) return notify('This browser blocked clipboard access. Select the value and copy it manually.', 'error', { title: 'Copy unavailable' });
    navigator.clipboard.writeText(value).then(() => {
      auditState.copied = label;
      renderAuditDrawer();
      notify(`${label} copied to the clipboard.`, 'success', { title: 'Copied to clipboard' });
      clearTimeout(auditState.copyTimer);
      auditState.copyTimer = window.setTimeout(() => { auditState.copied = ''; if (auditState.openId) renderAuditDrawer(); }, 1600);
    }, () => notify('The value could not be copied. Select it and copy manually.', 'error', { title: 'Copy failed' }));
  }

  function auditDetailRow(label, value, options = {}) {
    const copied = auditState.copied === label;
    const copy = options.copy ? `<button class="audit-copy${copied ? ' is-copied' : ''}" type="button" data-page-action="copy-audit-value" data-label="${esc(label)}" data-value="${esc(options.copy)}" aria-label="${copied ? `${esc(label)} copied` : `Copy ${esc(label.toLowerCase())}`}">${copied ? `<span class="table-status-badge" aria-hidden="true">${icon('check')}</span>` : icon('copy')}</button>` : '';
    return `<div class="audit-detail"><dt>${esc(label)}</dt><dd>${value}${copy}</dd></div>`;
  }

  function auditDrawerMarkup(entry) {
    const index = auditActors.findIndex(actor => actor[0] === entry.actor);
    const targetValue = entry.target.type === 'member' && entry.target.name
      ? `<span class="audit-detail-person">${avatarMarkup(entry.target.name, 4)}<span>${esc(entry.target.name)}</span><button class="audit-detail-link" type="button" data-page-action="open-audit-target" data-id="${entry.id}" aria-label="Open ${esc(entry.target.name)} in the host application">${icon('external')}</button></span>`
      : `<span class="audit-detail-value">${icon(entry.target.type === 'order' ? 'orders' : 'wallet')}<span>${esc(entry.target.label)}</span></span>`;
    const changes = entry.changes.length
      ? `<h3 class="audit-drawer-section">Changes</h3><div class="audit-changes"><div class="audit-changes-head"><span>Field</span><span>Before</span><span>After</span></div>${entry.changes.map(change => { const mark = change.field === 'Role' ? icon('shield') : ''; return `<div class="audit-change"><span class="audit-change-field">${esc(change.field)}</span><span class="audit-change-before">${mark}<span>${esc(change.before)}</span></span><span class="audit-change-after">${mark}<span>${esc(change.after)}</span></span></div>`; }).join('')}</div>`
      : '';
    const filteredEntries = filteredAudit();
    const eventIndex = filteredEntries.findIndex(item => item.id === entry.id);
    const previousDisabled = eventIndex <= 0 ? ' disabled' : '';
    const nextDisabled = eventIndex < 0 || eventIndex >= filteredEntries.length - 1 ? ' disabled' : '';
    return `<div class="audit-drawer-head"><h2 id="audit-drawer-title">${esc(entry.title)}</h2><button class="audit-drawer-close" type="button" data-page-action="close-audit-drawer" aria-label="Close details">${icon('close')}</button></div>
<div class="audit-drawer-body">
  <div class="audit-drawer-identity">${avatarMarkup(entry.actorName, 5)}<h3>${esc(entry.actorName)}<span class="role-chip">${icon('shield')}${esc(entry.role)}</span></h3><p>${esc(entry.date)}</p></div>
  <h3 class="audit-drawer-section">Overview</h3>
  <dl class="audit-detail-list">
    ${auditDetailRow('Target', targetValue)}
    ${auditDetailRow('Location', `<span class="audit-detail-value">${icon('globe')}<span>${esc(entry.location)}</span></span>`)}
    ${auditDetailRow('Device', `<span class="audit-detail-value">${icon('monitor')}<span>${esc(entry.device)}</span></span>`)}
    ${auditDetailRow('IP address', `<span class="audit-detail-value">${icon('pin')}<span>${esc(entry.ip)}</span></span>`, { copy: entry.ip })}
    ${auditDetailRow('Event ID', `<span class="audit-detail-value">${icon('event')}<span class="audit-event-id">${esc(entry.eventId)}</span></span>`, { copy: entry.eventId })}
    ${auditDetailRow('Status', auditStatusMarkup(entry.status))}
  </dl>
  ${changes}
</div>
<div class="audit-drawer-foot"><button class="page-button" type="button" data-page-action="step-audit" data-step="previous"${previousDisabled}>${icon('chevronLeft')} Previous event</button><button class="page-button" type="button" data-page-action="step-audit" data-step="next"${nextDisabled}>Next event ${icon('chevronRight')}</button></div>`;
  }

  function renderAuditDrawer() {
    const entry = auditLog.find(item => item.id === auditState.openId);
    if (!entry) { document.body.classList.remove('audit-drawer-open'); drawerRoot.innerHTML = ''; return; }
    document.body.classList.add('audit-drawer-open');
    drawerRoot.innerHTML = `<button class="audit-drawer-scrim" type="button" data-page-action="close-audit-drawer" aria-label="Close audit event details"></button><aside class="audit-drawer" role="dialog" aria-modal="${window.matchMedia('(min-width: 1680px)').matches ? 'false' : 'true'}" aria-labelledby="audit-drawer-title" tabindex="-1">${auditDrawerMarkup(entry)}</aside>`;
    requestAnimationFrame(() => drawerRoot.querySelector('.audit-drawer')?.classList.add('is-open'));
  }

  function openAuditDrawer(id, trigger) {
    auditState.openId = id;
    if (trigger) auditDrawerTrigger = trigger;
    renderAuditDrawer();
    renderAuditTable();
    drawerRoot.querySelector('.audit-drawer')?.focus({ preventScroll: true });
  }

  function closeAuditDrawer(restoreFocus = true) {
    if (!auditState.openId) return;
    auditState.openId = '';
    const drawer = drawerRoot.querySelector('.audit-drawer');
    if (drawer) {
      drawer.classList.remove('is-open');
      window.setTimeout(() => {
        if (!auditState.openId) {
          drawerRoot.innerHTML = '';
          document.body.classList.remove('audit-drawer-open');
        }
      }, closeAnimationMs);
    } else {
      drawerRoot.innerHTML = '';
      document.body.classList.remove('audit-drawer-open');
    }
    renderAuditTable();
    if (restoreFocus && auditDrawerTrigger?.isConnected) auditDrawerTrigger.focus();
    auditDrawerTrigger = null;
  }

  function stepAuditEvent(step) {
    const rows = filteredAudit();
    const current = rows.findIndex(entry => entry.id === auditState.openId);
    if (current < 0) return;
    const next = step === 'next' ? current + 1 : current - 1;
    if (next < 0 || next >= rows.length) return notify(step === 'next' ? 'This is the last event in the current filter.' : 'This is the first event in the current filter.', 'info', { title: 'No more events' });
    auditState.page = Math.floor(next / auditState.pageSize) + 1;
    auditState.openId = rows[next].id;
    renderAuditDrawer();
    renderAuditTable();
    drawerRoot.querySelector('.audit-drawer')?.focus({ preventScroll: true });
  }

  // ---------- API ----------

  function filteredApiKeys() {
    const query = apiState.query.trim().toLowerCase();
    return apiKeys.filter(key => !query || [key.name, key.environment, key.prefix].join(' ').toLowerCase().includes(query));
  }

  function apiKeyRow(key, index) {
    const revealed = apiState.revealedKeyId === key.id;
    return `<tr><td class="col-name" data-label="Name"><span class="table-person">${avatarMarkup(key.name, index)}<strong>${esc(key.name)}</strong></span></td><td class="col-role" data-label="Environment"><span class="table-cell-icon">${icon('code')}<span>${esc(key.environment)}</span></span></td><td class="col-source" data-label="Key"><code>${revealed ? esc(`${key.prefix}••••••••••••••••`) : esc(`${key.prefix}••••`)}</code></td><td class="col-status" data-label="Status">${statusMarkup(key.status === 'Active' ? 'Enabled' : 'Disabled')}</td><td class="col-login" data-label="Last used">${esc(key.lastUsed)}</td><td class="col-date" data-label="Created">${esc(key.created)}</td><td class="col-actions" data-label="Action"><button class="row-menu-trigger" type="button" data-page-action="api-menu" data-id="${key.id}" aria-label="Actions for ${esc(key.name)}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button></td></tr>`;
  }

  function renderApiKeysTable() {
    const host = document.querySelector('#api-keys-data');
    if (!host) return;
    if (apiState.loading) { host.innerHTML = skeletonMarkup(4); return; }
    const rows = filteredApiKeys();
    if (!rows.length) { host.innerHTML = emptyMarkup('No API keys found', 'Try another search term or create a new key.', ''); return; }
    host.innerHTML = `<div class="data-table-scroll"><table class="data-table data-table--api"><thead><tr><th class="col-name">Name</th><th class="col-role">Environment</th><th class="col-source">Key</th><th class="col-status">Status</th><th class="col-login">Last used</th><th class="col-date">Created</th><th class="col-actions">Action</th></tr></thead><tbody>${rows.map(apiKeyRow).join('')}</tbody></table></div>`;
  }

  function apiUsageChartMarkup() {
    return lineChartMarkup([{ label: 'Requests', unit: '', values: apiUsageRequests, className: 'is-users' }], apiUsageLabels, 'API requests over time', 0, Math.max(1000000, ...apiUsageRequests), ['1M', '750k', '500k', '250k', '0']);
  }

  function apiDashboardMarkup() {
    return `<div class="home-dashboard"><div class="home-metrics"><article class="home-metric"><div class="home-metric-head"><h2>Requests today</h2>${icon('code')}</div><strong>968.2K</strong><p><span>${icon('trend')}8.1%</span> from yesterday</p></article><article class="home-metric"><div class="home-metric-head"><h2>Error rate</h2>${icon('statusAlert')}</div><strong>0.5%</strong><p><span>${icon('trend')}0.2pp</span> from yesterday</p></article><article class="home-metric"><div class="home-metric-head"><h2>Median latency</h2>${icon('trend')}</div><strong>118ms</strong><p><span>${icon('trend')}6ms</span> from yesterday</p></article><article class="home-metric"><div class="home-metric-head"><h2>Active keys</h2>${icon('key')}</div><strong>${apiKeys.filter(key => key.status === 'Active').length}</strong><p>of ${apiKeys.length} total keys</p></article></div><div class="home-dashboard-grid"><section class="home-panel home-panel--chart" style="grid-column:1 / -1"><div class="home-panel-head"><div><h2>Requests</h2><p>Daily request volume across all keys</p></div></div>${apiUsageChartMarkup()}</section></div></div><section class="settings-section"><div class="section-heading"><h2>API keys</h2><p>Create and manage keys used to authenticate requests.</p></div><div style="grid-column:1 / -1;max-width:none"><div class="team-toolbar"><label class="table-search">${icon('search')}<input type="search" data-api-search value="${esc(apiState.query)}" placeholder="Search keys" aria-label="Search keys"></label><button class="page-button primary" type="button" data-page-action="create-api-key">${icon('plus')} Create API key</button></div><div class="data-table-shell" id="api-keys-data"></div></div></section>`;
  }

  function renderApi() {
    closeRowMenu(false);
    page.classList.add('is-data-page');
    pageTitle.textContent = 'API';
    document.title = 'API · Waya';
    tabs.hidden = true;
    headingActions.innerHTML = `<a class="page-button" href="https://docs.waya.dev" target="_blank" rel="noreferrer">${icon('code')} View docs</a>`;
    content.innerHTML = apiDashboardMarkup();
    renderApiKeysTable();
    if (apiState.loading) window.setTimeout(() => { apiState.loading = false; if (currentRoute() === '/api') renderApiKeysTable(); }, dataDelay);
  }

  function createApiKeyModal() {
    modal('Create API key', 'This key is generated locally for this preview and grants access to the environment you select.', `<form id="create-api-key-form"><div class="form-field t-input-wrap"><label for="api-key-name">Key name</label><input class="t-input" id="api-key-name" name="name" required maxlength="60" placeholder="e.g. Checkout service"><small class="error-message t-error-msg"></small></div><div class="form-field t-input-wrap"><label for="api-key-environment">Environment</label><select class="t-input" id="api-key-environment" name="environment" required><option>Live</option><option>Test</option></select><small class="error-message t-error-msg"></small></div></form>`, `<button class="button secondary" data-action="close">Cancel</button><button class="button" form="create-api-key-form">Generate key</button>`);
  }

  function revealApiKeyModal(key, secret) {
    modal('Copy your new key', 'For your security, the full key is only shown once. Store it in a secure location.', `<div class="form-field t-input-wrap"><label for="new-api-key-value">${esc(key.name)} · ${esc(key.environment)}</label><input class="t-input" id="new-api-key-value" readonly value="${esc(secret)}"></div><p class="notice">This preview does not send requests to a real API. Treat this value as a sample only.</p>`, `<button class="button secondary" data-action="close">Close</button><button class="button" type="button" data-page-action="copy-new-api-key" data-secret="${esc(secret)}">${icon('copy')} Copy key</button>`);
  }

  // ---------- Report ----------

  function reportHeadingActions() {
    const range = reportRanges[reportState.range];
    headingActions.innerHTML = `<span class="home-range-wrap"><button class="page-button home-date-button" type="button" data-page-action="toggle-report-range" aria-expanded="${reportState.rangeOpen}" aria-haspopup="menu">${icon('calendar')} <span>${esc(range.label)}</span></button>${reportState.rangeOpen ? `<div class="home-range-menu t-dropdown" role="menu">${Object.entries(reportRanges).map(([value, item]) => `<button type="button" role="menuitemradio" aria-checked="${value === reportState.range}" data-page-action="select-report-range" data-range="${value}"><span>${esc(item.label)}</span>${value === reportState.range ? icon('check') : ''}</button>`).join('')}</div>` : ''}</span><button class="page-button" type="button" data-page-action="download-report">${icon('download')} Download</button>`;
    if (reportState.rangeOpen) requestAnimationFrame(() => headingActions.querySelector('.home-range-menu')?.classList.add('is-open'));
  }

  function reportSkeletonMarkup() {
    return `<div class="home-dashboard home-dashboard--loading" aria-label="Loading report"><div class="home-metrics">${Array.from({ length: 4 }, () => '<div class="home-metric home-skeleton-card"><i></i><b></b><span></span></div>').join('')}</div><div class="home-dashboard-grid">${Array.from({ length: 4 }, () => '<section class="home-panel home-skeleton-panel"><i></i><b></b><span></span></section>').join('')}</div></div>`;
  }

  function reportDonutMarkup() {
    const slices = [
      { label: 'Equities', count: '₦1.62B', percent: '48.1%', start: 0, end: 48.1, className: 'is-users' },
      { label: 'Fixed income', count: '₦1.05B', percent: '31.2%', start: 48.1, end: 79.3, className: 'is-orders' },
      { label: 'Money market', count: '₦0.70B', percent: '20.7%', start: 79.3, end: 100, className: 'is-activation' }
    ];
    return `<div class="home-pie-wrap"><svg class="home-pie" viewBox="0 0 42 42" role="group" aria-label="Revenue by instrument class">${slices.map((slice, index) => `<path class="home-pie-slice ${slice.className}" d="${pieSlicePath(slice.start, slice.end)}" tabindex="0" role="button" aria-label="${slice.label}: ${slice.count}, ${slice.percent}" data-pie-index="${index}" data-label="${slice.label}" data-count="${slice.count}" data-percent="${slice.percent}"></path>`).join('')}</svg><div class="home-data-tooltip home-pie-tooltip" role="tooltip" aria-hidden="true"></div></div><dl class="home-status-list">${slices.map((slice, index) => `<div data-pie-legend="${index}"><dt><i class="${slice.className}"></i>${slice.label}</dt><dd>${slice.count} (${slice.percent})</dd></div>`).join('')}</dl>`;
  }

  function reportDashboardMarkup() {
    const data = reportRanges[reportState.range];
    const labels = data.shortLabels;
    const revenueVolume = lineChartMarkup([
      { label: 'Revenue', unit: 'M', values: data.revenue, className: 'is-users' },
      { label: 'Volume', unit: 'M', values: data.volume, className: 'is-orders' }
    ], labels, 'Revenue and volume over time', 0, Math.max(400, ...data.volume), ['400m', '300m', '200m', '100m', '0']);
    const settlement = lineChartMarkup([{ label: 'Settlement rate', unit: '%', values: data.settlement, className: 'is-activation' }], labels, 'Settlement success rate', 90, 100, ['100%', '97.5%', '95%', '92.5%', '90%']);
    const bars = [['Institutional desk', '₦138,210,000', '48.6%', '82%'], ['Retail desk', '₦96,440,000', '33.9%', '58%'], ['Partner channel', '₦50,150,000', '17.5%', '30%']];
    return `<div class="home-dashboard"><div class="home-metrics">${data.metrics.map(([label, value, change, iconName]) => `<article class="home-metric"><div class="home-metric-head"><h2>${esc(label)}</h2>${icon(iconName)}</div><strong>${esc(value)}</strong><p><span>${icon('trend')}${esc(change)}</span> from last period</p></article>`).join('')}</div><div class="home-dashboard-grid"><section class="home-panel home-panel--chart"><div class="home-panel-head"><div><h2>Revenue &amp; Volume</h2><p>Track platform performance <span class="home-legend"><i class="is-users"></i>Revenue <i class="is-orders"></i>Volume</span></p></div></div>${revenueVolume}</section><section class="home-panel home-panel--chart"><div class="home-panel-head"><div><h2>Settlement Rate</h2><p>${esc(data.settlement.at(-1))}% settled on time <span class="home-change">${icon('trend')}1.9pp</span> from last period</p></div></div>${settlement}</section><section class="home-panel home-order-status"><div class="home-panel-head"><div><h2>Revenue by Instrument</h2><p>Share of revenue by asset class</p></div></div>${reportDonutMarkup()}</section><section class="home-panel home-brokerage"><div class="home-panel-head"><div><h2>Revenue by Desk</h2><p>See total revenue breakdown</p></div></div><span class="home-brokerage-total-wrap" tabindex="0" aria-describedby="report-total-tooltip"><strong class="home-brokerage-total">₦284.8M</strong><span class="home-data-tooltip home-total-tooltip" id="report-total-tooltip" role="tooltip"><strong>Total revenue</strong><span>Sum of Institutional desk, Retail desk, and Partner channel.</span></span></span><p class="home-brokerage-change"><span>${icon('trend')}15.2%</span> from last period</p><div class="home-bars">${bars.map(([label, amount, percent, width]) => `<div class="home-bar" tabindex="0" aria-label="${esc(`${label}: ${amount}, ${percent}`)}"><div><span>${label}</span><strong>${amount} (${percent})</strong></div><i><b style="width:${width}"></b></i><span class="home-data-tooltip home-bar-tooltip" role="tooltip"><strong>${label}</strong><span>${amount} · ${percent}</span></span></div>`).join('')}</div></section></div></div>`;
  }

  function renderReport() {
    closeRowMenu(false);
    page.classList.add('is-data-page', 'is-home-page');
    pageTitle.textContent = 'Report';
    document.title = 'Report · Waya';
    tabs.hidden = true;
    reportHeadingActions();
    content.innerHTML = reportState.loading ? reportSkeletonMarkup() : reportDashboardMarkup();
  }

  // ---------- Business trading ----------

  function positionRow(position, index) {
    const positive = position.pl >= 0;
    return `<tr><td class="col-name" data-label="Instrument"><span class="table-cell-icon">${icon('trend')}<span>${esc(position.instrument)}</span></span></td><td class="col-email" data-label="Quantity">${esc(position.quantity)}</td><td class="col-role" data-label="Avg. cost">${esc(position.avgCost)}</td><td class="col-amount" data-label="Market value">${new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(position.marketValue)}</td><td class="col-date position-pl" data-label="P&amp;L" style="color:${positive ? 'var(--color-success)' : 'var(--color-danger)'}">${positive ? '+' : ''}${new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(position.pl)} (${positive ? '+' : ''}${position.plPercent})</td></tr>`;
  }

  function businessTradingMarkup() {
    const metrics = [['Account balance', '₦29,053,880', '4.8%', 'wallet'], ['Buying power', '₦8,412,210', '2.1%', 'card'], ["Today's P&L", '+₦1,675,320', '9.4%', 'trend'], ['Open positions', String(positions.length), '0%', 'building']];
    return `<div class="home-dashboard"><div class="home-metrics">${metrics.map(([label, value, change, iconName]) => `<article class="home-metric"><div class="home-metric-head"><h2>${esc(label)}</h2>${icon(iconName)}</div><strong>${esc(value)}</strong><p><span>${icon('trend')}${esc(change)}</span> from last week</p></article>`).join('')}</div></div><section class="settings-section"><div class="section-heading"><h2>Open positions</h2><p>Holdings currently in this trading account.</p></div><div style="grid-column:1 / -1;max-width:none"><div class="data-table-scroll"><table class="data-table data-table--positions"><thead><tr><th class="col-name">Instrument</th><th class="col-email">Quantity</th><th class="col-role">Avg. cost</th><th class="col-amount">Market value</th><th class="col-date">P&amp;L</th></tr></thead><tbody>${positions.map(positionRow).join('')}</tbody></table></div></div></section>`;
  }

  function renderBusinessTrading() {
    closeRowMenu(false);
    page.classList.add('is-data-page');
    pageTitle.textContent = 'Business trading';
    document.title = 'Business trading · Waya';
    tabs.hidden = true;
    headingActions.innerHTML = `<button class="page-button" type="button" data-page-action="open-new-account">${icon('plus')} New account</button>`;
    content.innerHTML = businessTradingMarkup();
  }

  // ---------- New account ----------

  function newAccountMarkup() {
    return `<section class="settings-section"><div class="section-heading"><h2>Account details</h2><p>Create an additional trading account for this workspace.</p></div><div><form id="new-account-form" novalidate><div class="form-field t-input-wrap"><label for="account-name">Account name</label><input class="t-input" id="account-name" name="accountName" required placeholder="e.g. Treasury desk"><small class="error-message t-error-msg"></small></div><div class="form-field t-input-wrap"><label for="account-type">Account type</label><select class="t-input" id="account-type" name="accountType" required><option value="">Select a type</option><option>Individual</option><option>Corporate</option><option>Joint</option></select><small class="error-message t-error-msg"></small></div><div class="form-field t-input-wrap"><label for="account-currency">Base currency</label><select class="t-input" id="account-currency" name="accountCurrency" required><option value="">Select a currency</option><option>NGN — Nigerian Naira</option><option>USD — US Dollar</option><option>GBP — British Pound</option></select><small class="error-message t-error-msg"></small></div><div class="form-field t-input-wrap"><label for="account-funding">Initial funding source</label><select class="t-input" id="account-funding" name="accountFunding" required><option value="">Select a source</option><option>Business trading account</option><option>Bank transfer</option><option>No initial funding</option></select><small class="error-message t-error-msg"></small></div><button class="button" type="submit" id="new-account-submit">Create account</button></form></div></section>`;
  }

  function renderNewAccount() {
    closeRowMenu(false);
    page.classList.add('is-data-page');
    pageTitle.textContent = 'New account';
    document.title = 'New account · Waya';
    tabs.hidden = true;
    headingActions.innerHTML = '';
    content.innerHTML = newAccountMarkup();
  }

  // ---------- Help ----------

  function helpMarkup() {
    return `<div class="support-grid"><article class="support-card">${icon('question')}<h2>Help centre</h2><p>Read guides and answers to common questions.</p><button data-action="help-centre">Open help centre ${icon('external')}</button></article><article class="support-card">${icon('headset')}<h2>Contact support</h2><p>Send a message to the support team.</p><button data-action="support">Contact support ${icon('arrow')}</button></article><article class="support-card">${icon('report')}<h2>Report a problem</h2><p>Tell us about a technical issue with the product.</p><button data-action="report-problem">Report a problem ${icon('arrow')}</button></article></div>`;
  }

  function renderHelp() {
    closeRowMenu(false);
    page.classList.add('is-data-page');
    pageTitle.textContent = 'Help';
    document.title = 'Help · Waya';
    tabs.hidden = true;
    headingActions.innerHTML = '';
    content.innerHTML = helpMarkup();
  }

  function renderPlaceholder(route) {
    closeRowMenu(false);
    page.classList.add('is-data-page');
    const title = titleForRoute(route);
    pageTitle.textContent = title;
    document.title = `${title} · Waya`;
    tabs.hidden = true;
    headingActions.innerHTML = '';
    content.innerHTML = emptyMarkup(`${title} is ready for its product flow`, 'This route is connected to the shared shell. Its domain-specific screen has not been added to this preview.', '', '');
  }

  function linePoints(values, min, max) {
    const left = 48, top = 16, width = 534, height = 174;
    const span = Math.max(1, max - min);
    return values.map((value, index) => {
      const x = left + (index / Math.max(1, values.length - 1)) * width;
      const y = top + (1 - (value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  function lineChartMarkup(lines, labels, title, min, max, yLabels) {
    const chartLines = lines.map(line => ({ ...line, values: line.values.slice(0, labels.length) }));
    const segment = 534 / Math.max(1, labels.length - 1);
    const zones = labels.map((label, index) => {
      const center = 48 + (index / Math.max(1, labels.length - 1)) * 534;
      const start = index === 0 ? 48 : center - segment / 2;
      const end = index === labels.length - 1 ? 582 : center + segment / 2;
      const summary = chartLines.map(line => `${line.label}: ${line.values[index]}${line.unit || ''}`).join(', ');
      return `<rect class="home-chart-hit-zone" x="${start.toFixed(1)}" y="16" width="${(end - start).toFixed(1)}" height="174" tabindex="0" role="button" aria-label="${esc(`${label}. ${summary}`)}" data-chart-index="${index}" data-chart-x="${center.toFixed(1)}"></rect>`;
    }).join('');
    return `<div class="home-chart" role="group" aria-label="${esc(title)}"><div class="home-chart-y" aria-hidden="true">${yLabels.map(label => `<span>${esc(label)}</span>`).join('')}</div><svg viewBox="0 0 600 206" preserveAspectRatio="none"><defs><pattern id="home-grid-${title.replace(/\W/g, '')}" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7"></circle></pattern></defs><rect class="home-chart-grid" x="48" y="16" width="534" height="174" fill="url(#home-grid-${title.replace(/\W/g, '')})"></rect>${chartLines.map(line => `<polyline class="home-chart-line ${line.className}" data-label="${esc(line.label)}" data-unit="${esc(line.unit || '')}" data-values="${line.values.join(',')}" points="${linePoints(line.values, min, max)}"></polyline>`).join('')}<line class="home-chart-guideline" x1="48" x2="48" y1="16" y2="190"></line><g class="home-chart-hover-points"></g><g class="home-chart-hit-zones">${zones}</g></svg><div class="home-chart-labels" aria-hidden="true">${labels.map(label => `<span>${esc(label)}</span>`).join('')}</div><div class="home-data-tooltip home-chart-tooltip" role="tooltip" aria-hidden="true"></div></div>`;
  }

  function pieSlicePath(startPercent, endPercent) {
    const center = 21, radius = 18, startAngle = startPercent * 3.6 - 90, endAngle = endPercent * 3.6 - 90;
    const point = angle => [center + radius * Math.cos(angle * Math.PI / 180), center + radius * Math.sin(angle * Math.PI / 180)];
    const [x1, y1] = point(startAngle), [x2, y2] = point(endAngle);
    return `M ${center} ${center} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${radius} ${radius} 0 ${endPercent - startPercent > 50 ? 1 : 0} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`;
  }

  function orderStatusMarkup() {
    const slices = [
      { label: 'Successful', count: '1.10M', percent: '85.5%', start: 0, end: 85.5, className: 'is-success' },
      { label: 'Pending', count: '128.4K', percent: '10.0%', start: 85.5, end: 95.5, className: 'is-pending' },
      { label: 'Failed', count: '58.1K', percent: '4.5%', start: 95.5, end: 100, className: 'is-failed' }
    ];
    return `<div class="home-pie-wrap"><svg class="home-pie" viewBox="0 0 42 42" role="group" aria-label="Order status distribution">${slices.map((slice, index) => `<path class="home-pie-slice ${slice.className}" d="${pieSlicePath(slice.start, slice.end)}" tabindex="0" role="button" aria-label="${slice.label}: ${slice.count}, ${slice.percent}" data-pie-index="${index}" data-label="${slice.label}" data-count="${slice.count}" data-percent="${slice.percent}"></path>`).join('')}</svg><div class="home-data-tooltip home-pie-tooltip" role="tooltip" aria-hidden="true"></div></div><dl class="home-status-list">${slices.map((slice, index) => `<div data-pie-legend="${index}"><dt><i class="${slice.className}"></i>${slice.label}</dt><dd>${slice.count} (${slice.percent})</dd></div>`).join('')}</dl>`;
  }

  function homeHeadingActions() {
    const range = homeRanges[homeState.range];
    headingActions.innerHTML = `<span class="home-range-wrap"><button class="page-button home-date-button" type="button" data-page-action="toggle-home-range" aria-expanded="${homeState.rangeOpen}" aria-haspopup="menu">${icon('calendar')} <span>${esc(range.label)}</span></button>${homeState.rangeOpen ? `<div class="home-range-menu t-dropdown" role="menu">${Object.entries(homeRanges).map(([value, item]) => `<button type="button" role="menuitemradio" aria-checked="${value === homeState.range}" data-page-action="select-home-range" data-range="${value}"><span>${esc(item.label)}</span>${value === homeState.range ? icon('check') : ''}</button>`).join('')}</div>` : ''}</span><button class="page-button" type="button" data-page-action="download-home">${icon('download')} Download</button><button class="page-button" type="button" data-page-action="open-api-dashboard">Go to API Dashboard ${icon('upRight')}</button>`;
    if (homeState.rangeOpen) requestAnimationFrame(() => headingActions.querySelector('.home-range-menu')?.classList.add('is-open'));
  }

  function homeSkeletonMarkup() {
    return `<div class="home-dashboard home-dashboard--loading" aria-label="Loading dashboard"><div class="home-metrics">${Array.from({ length: 4 }, () => '<div class="home-metric home-skeleton-card"><i></i><b></b><span></span></div>').join('')}</div><div class="home-dashboard-grid">${Array.from({ length: 4 }, () => '<section class="home-panel home-skeleton-panel"><i></i><b></b><span></span></section>').join('')}</div></div>`;
  }

  function homeDashboardMarkup() {
    const data = homeRanges[homeState.range];
    const labels = data.shortLabels;
    const usersAndOrders = lineChartMarkup([
      { label: 'Users', unit: 'K', values: data.users, className: 'is-users' },
      { label: 'Orders', unit: 'K', values: data.orders, className: 'is-orders' }
    ], labels, 'Users and orders over time', 0, Math.max(2000, ...data.orders), ['2m', '1.5m', '1m', '500k', '0']);
    const activation = lineChartMarkup([{ label: 'Active rate', unit: '%', values: data.activation, className: 'is-activation' }], labels, 'Registered versus active users', 40, 52.5, ['50%', '47.5%', '45%', '42.5%', '0']);
    const bars = [['Buying power','$91,412,210','32.1%','20%'],['Unsettled cash','$132,048,310','46.4%','82%'],['Reserved Cash','$61,161,320','21.5%','30%']];
    return `<div class="home-dashboard"><div class="home-metrics">${data.metrics.map(([label, value, change, iconName]) => `<article class="home-metric"><div class="home-metric-head"><h2>${esc(label)}</h2>${icon(iconName)}</div><strong>${esc(value)}</strong><p><span>${icon('trend')}${esc(change)}</span> from last week</p></article>`).join('')}</div><div class="home-dashboard-grid"><section class="home-panel home-panel--chart"><div class="home-panel-head"><div><h2>Users &amp; Orders</h2><p>See how orders are performing <span class="home-legend"><i class="is-users"></i>Users <i class="is-orders"></i>Order</span></p></div></div>${usersAndOrders}</section><section class="home-panel home-panel--chart"><div class="home-panel-head"><div><h2>Registered vs Active Users</h2><p>47.9% Activation rate <span class="home-change">${icon('trend')}15.2%</span> from last week</p></div></div>${activation}</section><section class="home-panel home-order-status"><div class="home-panel-head"><div><h2>Order Status</h2><p>See how orders are performing</p></div></div>${orderStatusMarkup()}</section><section class="home-panel home-brokerage"><div class="home-panel-head"><div><h2>Brokerage</h2><p>See total brokerage breakdown</p></div></div><span class="home-brokerage-total-wrap" tabindex="0" aria-describedby="brokerage-total-tooltip"><strong class="home-brokerage-total">$284.6M</strong><span class="home-data-tooltip home-total-tooltip" id="brokerage-total-tooltip" role="tooltip"><strong>Total brokerage</strong><span>Sum of Buying power, Unsettled cash, and Reserved Cash.</span></span></span><p class="home-brokerage-change"><span>${icon('trend')}20.01%</span> from last week</p><div class="home-bars">${bars.map(([label, amount, percent, width]) => `<div class="home-bar" tabindex="0" aria-label="${esc(`${label}: ${amount}, ${percent}`)}"><div><span>${label}</span><strong>${amount} (${percent})</strong></div><i><b style="width:${width}"></b></i><span class="home-data-tooltip home-bar-tooltip" role="tooltip"><strong>${label}</strong><span>${amount} · ${percent}</span></span></div>`).join('')}</div></section></div></div>`;
  }

  function renderHome() {
    closeRowMenu(false);
    page.classList.add('is-data-page', 'is-home-page');
    pageTitle.textContent = 'Home';
    document.title = 'Home · Waya';
    tabs.hidden = true;
    homeHeadingActions();
    content.innerHTML = homeState.loading ? homeSkeletonMarkup() : homeDashboardMarkup();
  }

  renderPanel = function () {
    if (state.tab === 'team') renderTeam();
    else legacyRenderPanel();
  };

  setTab = function (tab) {
    state.tab = tab;
    const url = new URL(location.href);
    url.hash = '/settings';
    url.searchParams.set('tab', tab);
    history.pushState({}, '', url);
    render();
  };

  render = function () {
    const route = currentRoute();
    document.body.classList.toggle('is-audit-route', route === '/audit-log');
    page.classList.remove('is-home-page');
    pageNotice.innerHTML = '';
    if (route !== '/audit-log') closeAuditDrawer(false);
    if (route === '/dashboard') return renderHome();
    if (route === '/account') return renderAccount();
    if (route === '/transactions') return renderTransactions();
    if (route === '/users') return renderUsers();
    if (route === '/orders') return renderOrders();
    if (route === '/reports') return renderReport();
    if (route === '/audit-log') return renderAuditLog();
    if (route === '/api') return renderApi();
    if (route === '/business-trading') return renderBusinessTrading();
    if (route === '/accounts/new') return renderNewAccount();
    if (route === '/help') return renderHelp();
    if (route === '/settings/team') state.tab = 'team';
    if (route !== '/settings' && route !== '/settings/team') return renderPlaceholder(route);
    page.classList.remove('is-data-page');
    pageTitle.textContent = 'Settings';
    document.title = 'Settings · Waya';
    tabs.hidden = false;
    headingActions.innerHTML = '';
    legacyRender();
  };

  function closeFilter(kind) {
    if (kind === 'transactions') transactionState.filterOpen = false;
    else teamState.filterOpen = false;
  }

  function changeTransactionPage(action) {
    const totalPages = Math.max(1, Math.ceil(filteredTransactions().length / transactionState.pageSize));
    if (action === 'first') transactionState.page = 1;
    if (action === 'previous') transactionState.page = Math.max(1, transactionState.page - 1);
    if (action === 'next') transactionState.page = Math.min(totalPages, transactionState.page + 1);
    if (action === 'last') transactionState.page = totalPages;
    transactionState.loading = true;
    renderTransactionTable();
    window.setTimeout(() => { transactionState.loading = false; renderTransactionTable(); document.querySelector('#transaction-data')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 300);
  }

  function selectedTransactions() {
    return transactions.filter(row => transactionState.selected.has(row.id));
  }

  function csvDownload(rows, filename = 'transactions.csv') {
    if (!rows.length) return notify('There are no transactions to download.', 'error', { title: 'Download unavailable' });
    const id = notify('Preparing a CSV file for download.', 'loading', { title: 'Download in progress', duration: 0, progress: 18 });
    window.setTimeout(() => updateNotice(id, { progress: 72, message: 'Formatting transaction rows.' }), 350);
    window.setTimeout(() => {
      try {
        const values = [['Transaction ID','User name','Direction','Source','Status','Amount','Date'], ...rows.map(row => [row.id,row.name,row.direction,row.source,row.status,row.amount,row.date])];
        const csv = values.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
        anchor.click();
        URL.revokeObjectURL(url);
        updateNotice(id, { type: 'success', title: 'Download ready', message: `${rows.length} transactions were exported.`, duration: 4500, progress: 100 });
      } catch {
        updateNotice(id, { type: 'error', title: 'Download failed', message: 'The file could not be created. Try again.', duration: 6500, progress: null, actionLabel: 'Retry', onAction: () => csvDownload(rows, filename) });
      }
    }, 750);
  }

  function downloadCsv(filename, header, rows) {
    if (!rows.length) return notify('There is no data to download.', 'error', { title: 'Download unavailable' });
    const id = notify('Preparing a CSV file for download.', 'loading', { title: 'Download in progress', duration: 0, progress: 20 });
    window.setTimeout(() => {
      try {
        const values = [header, ...rows];
        const csv = values.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
        anchor.click();
        URL.revokeObjectURL(url);
        updateNotice(id, { type: 'success', title: 'Download ready', message: `${rows.length} rows were exported.`, duration: 4500, progress: 100 });
      } catch {
        updateNotice(id, { type: 'error', title: 'Download failed', message: 'The file could not be created. Try again.', duration: 6500, progress: null });
      }
    }, 650);
  }

  function openConfirm(title, description, message, confirmLabel, action, danger = false) {
    modal(title, description, `<p class="member-selection-note">${esc(message)}</p>`, `<button class="button secondary" data-action="close">Cancel</button><button class="button ${danger ? 'danger' : ''}" data-page-action="${action}">${esc(confirmLabel)}</button>`);
  }

  function inviteMemberModal() {
    modal('Invite member', 'Add someone to this workspace and assign their starting role.', `<form id="invite-member-form" novalidate><div class="form-field t-input-wrap"><label for="invite-name">Full name</label><input class="t-input" id="invite-name" name="name" required autocomplete="name"><small class="error-message t-error-msg"></small></div><div class="form-field t-input-wrap"><label for="invite-email">Email address</label><input class="t-input" id="invite-email" name="email" type="email" required autocomplete="email"><small class="error-message t-error-msg"></small></div><div class="form-field t-input-wrap"><label for="invite-role">Role</label><select class="t-input" id="invite-role" name="role" required><option value="">Select a role</option><option>Admin</option><option>Developer</option><option>Operations</option><option>Customer Support</option></select><small class="error-message t-error-msg"></small></div></form>`, `<button class="button secondary" data-action="close">Cancel</button><button class="button" form="invite-member-form">Send invitation</button>`);
  }

  function manageRolesModal() {
    modal('Manage roles', 'Review the roles available in this workspace.', `<form id="manage-roles-form"><div class="session-list"><label class="session-card"><span class="session-device">${icon('shield')}</span><span class="session-info"><strong>Admin</strong><span>Manage members, settings and product operations.</span></span><input type="checkbox" checked aria-label="Admin role enabled"></label><label class="session-card"><span class="session-device">${icon('code')}</span><span class="session-info"><strong>Developer</strong><span>Access API tools and technical settings.</span></span><input type="checkbox" checked aria-label="Developer role enabled"></label><label class="session-card"><span class="session-device">${icon('users')}</span><span class="session-info"><strong>Customer Support</strong><span>Manage users and support workflows.</span></span><input type="checkbox" checked aria-label="Customer Support role enabled"></label></div></form>`, `<button class="button secondary" data-action="close">Cancel</button><button class="button" form="manage-roles-form">Save roles</button>`);
  }

  function changeRoleModal(member) {
    modal('Change role', `Update ${member.name}’s access to this workspace.`, `<form id="change-role-form" data-member-id="${member.id}"><div class="form-field t-input-wrap"><label for="member-role">Role</label><select class="t-input" id="member-role" required>${['Owner','Admin','Developer','Operations','Customer Support'].map(role => `<option ${role === member.role ? 'selected' : ''}>${role}</option>`).join('')}</select><small class="error-message t-error-msg"></small></div></form>`, `<button class="button secondary" data-action="close">Cancel</button><button class="button" form="change-role-form">Update role</button>`);
  }

  function showFieldError(input, message) {
    const wrap = input.closest('.form-field');
    const error = wrap?.querySelector('.error-message');
    wrap?.classList.add('is-error');
    input.classList.add('is-error');
    input.setAttribute('aria-invalid', 'true');
    if (error) error.textContent = message;
    input.classList.remove('is-shaking');
    void input.offsetWidth;
    input.classList.add('is-shaking');
    input.focus();
  }

  function clearFieldError(input) {
    const wrap = input.closest('.form-field');
    wrap?.classList.remove('is-error');
    input.classList.remove('is-error', 'is-shaking');
    input.removeAttribute('aria-invalid');
    const error = wrap?.querySelector('.error-message');
    if (error) error.textContent = '';
  }

  function openRowMenu(trigger, member) {
    openActionMenu(trigger, `Actions for ${member.name}`, `<button role="menuitem" data-member-action="enforce" data-id="${member.id}">${icon('shield')}<span>Enforce 2FA</span></button><button role="menuitem" data-member-action="reset" data-id="${member.id}">${icon('key')}<span>Reset Password</span></button><div class="menu-divider"></div><button role="menuitem" data-member-action="role" data-id="${member.id}">${icon('card')}<span>Change role</span></button><div class="menu-divider"></div><button role="menuitem" data-member-action="remove" data-id="${member.id}" data-danger>${icon('trash')}<span>Remove member</span></button>`);
  }

  function closeRowMenu(returnFocus = false) {
    if (!rowMenu) return;
    const closing = rowMenu;
    rowMenu = null;
    rowMenuTrigger?.setAttribute('aria-expanded', 'false');
    closing.classList.remove('is-open');
    closing.classList.add('is-closing');
    window.setTimeout(() => closing.remove(), closeAnimationMs);
    if (returnFocus) rowMenuTrigger?.focus();
    rowMenuTrigger = null;
  }

  const originalCloseOverlay = closeOverlay;
  closeOverlay = function () {
    const dialog = overlay.querySelector('.dialog');
    const backdrop = overlay.querySelector('.backdrop');
    if (!dialog || dialog.classList.contains('is-closing')) return originalCloseOverlay();
    dialog.classList.remove('is-open');
    dialog.classList.add('is-closing');
    backdrop?.classList.add('is-closing');
    window.setTimeout(() => originalCloseOverlay(), closeAnimationMs);
  };

  modal = function (title, description, body, footer) {
    overlay.innerHTML = `<div class="backdrop" data-backdrop><section class="dialog t-modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="dialog-head"><div><h2 id="dialog-title">${title}</h2><p>${description}</p></div><button class="icon-button" data-action="close" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ''}</section></div>`;
    overlay.removeAttribute('aria-hidden');
    requestAnimationFrame(() => overlay.querySelector('.dialog')?.classList.add('is-open'));
    overlay.querySelector('input,button,select,textarea')?.focus();
  };

  function chartPoint(polyline, index) {
    const pair = (polyline.getAttribute('points') || '').trim().split(/\s+/)[index]?.split(',').map(Number);
    return pair?.length === 2 ? { x: pair[0], y: pair[1] } : null;
  }

  function showChartHover(zone, clientY) {
    const chart = zone.closest('.home-chart');
    const svg = chart?.querySelector('svg');
    if (!chart || !svg) return;
    const index = Number(zone.dataset.chartIndex);
    const lines = [...chart.querySelectorAll('.home-chart-line')];
    const points = lines.map(line => ({ line, point: chartPoint(line, index), value: Number((line.dataset.values || '').split(',')[index]) })).filter(item => item.point);
    if (!points.length) return;
    const rect = svg.getBoundingClientRect();
    const viewY = Number.isFinite(clientY) ? (clientY - rect.top) / Math.max(1, rect.height) * 206 : points[0].point.y;
    const hovered = points.reduce((closest, item) => Math.abs(item.point.y - viewY) < Math.abs(closest.point.y - viewY) ? item : closest, points[0]);
    lines.forEach(line => line.classList.toggle('is-hovered', line === hovered.line));
    chart.classList.add('is-hovering');
    const x = Number(zone.dataset.chartX);
    const guide = chart.querySelector('.home-chart-guideline');
    guide?.setAttribute('x1', x);
    guide?.setAttribute('x2', x);
    const markerGroup = chart.querySelector('.home-chart-hover-points');
    if (markerGroup) markerGroup.innerHTML = points.map(item => `<circle class="home-chart-point ${item.line.classList.contains('is-users') ? 'is-users' : item.line.classList.contains('is-orders') ? 'is-orders' : 'is-activation'}" cx="${item.point.x}" cy="${item.point.y}" r="4"></circle>`).join('');
    const date = chart.querySelectorAll('.home-chart-labels span')[index]?.textContent || '';
    const tooltip = chart.querySelector('.home-chart-tooltip');
    if (tooltip) {
      tooltip.innerHTML = `<strong>${esc(date)}</strong>${points.map(item => `<span><i class="${item.line.classList.contains('is-users') ? 'is-users' : item.line.classList.contains('is-orders') ? 'is-orders' : 'is-activation'}"></i>${esc(item.line.dataset.label)} <b>${esc(`${item.value}${item.line.dataset.unit || ''}`)}</b></span>`).join('')}`;
      tooltip.style.left = `${x / 6}%`;
      tooltip.style.top = `${Math.max(8, Math.min(...points.map(item => item.point.y)) / 2.06)}%`;
      tooltip.classList.toggle('is-left-edge', index === 0);
      tooltip.classList.toggle('is-right-edge', index === chart.querySelectorAll('[data-chart-index]').length - 1);
      tooltip.setAttribute('aria-hidden', 'false');
    }
  }

  function hideChartHover(chart) {
    if (!chart) return;
    chart.classList.remove('is-hovering');
    chart.querySelectorAll('.home-chart-line').forEach(line => line.classList.remove('is-hovered'));
    const markerGroup = chart.querySelector('.home-chart-hover-points');
    if (markerGroup) markerGroup.innerHTML = '';
    chart.querySelector('.home-chart-tooltip')?.setAttribute('aria-hidden', 'true');
  }

  function showPieHover(slice) {
    const panel = slice.closest('.home-order-status');
    if (!panel) return;
    const index = slice.dataset.pieIndex;
    panel.classList.add('is-pie-hovering');
    panel.querySelectorAll('.home-pie-slice').forEach(item => item.classList.toggle('is-hovered', item === slice));
    panel.querySelectorAll('[data-pie-legend]').forEach(item => item.classList.toggle('is-hovered', item.dataset.pieLegend === index));
    const tooltip = panel.querySelector('.home-pie-tooltip');
    if (tooltip) {
      tooltip.innerHTML = `<strong>${esc(slice.dataset.label)}</strong><span>${esc(slice.dataset.count)} (${esc(slice.dataset.percent)})</span>`;
      tooltip.setAttribute('aria-hidden', 'false');
    }
  }

  function hidePieHover(panel) {
    if (!panel) return;
    panel.classList.remove('is-pie-hovering');
    panel.querySelectorAll('.is-hovered').forEach(item => item.classList.remove('is-hovered'));
    panel.querySelector('.home-pie-tooltip')?.setAttribute('aria-hidden', 'true');
  }

  document.addEventListener('pointermove', event => {
    const zone = event.target.closest?.('[data-chart-index]');
    if (zone) showChartHover(zone, event.clientY);
  });

  document.addEventListener('pointerover', event => {
    const slice = event.target.closest?.('[data-pie-index]');
    if (slice) showPieHover(slice);
  });

  document.addEventListener('pointerout', event => {
    const chart = event.target.closest?.('.home-chart');
    if (chart && !chart.contains(event.relatedTarget)) hideChartHover(chart);
    const pieWrap = event.target.closest?.('.home-pie-wrap');
    if (pieWrap && !pieWrap.contains(event.relatedTarget)) hidePieHover(pieWrap.closest('.home-order-status'));
  });

  document.addEventListener('focusin', event => {
    const zone = event.target.closest?.('[data-chart-index]');
    if (zone) showChartHover(zone, NaN);
    const slice = event.target.closest?.('[data-pie-index]');
    if (slice) showPieHover(slice);
  });

  document.addEventListener('focusout', event => {
    const chart = event.target.closest?.('.home-chart');
    if (chart && !chart.contains(event.relatedTarget)) hideChartHover(chart);
    const pieWrap = event.target.closest?.('.home-pie-wrap');
    if (pieWrap && !pieWrap.contains(event.relatedTarget)) hidePieHover(pieWrap.closest('.home-order-status'));
  });

  document.addEventListener('input', event => {
    const input = event.target;
    if (input.matches('.form-field input,.form-field select,.form-field textarea')) clearFieldError(input);
    if (input.matches('[data-team-search]')) {
      teamState.query = input.value;
      teamState.loading = true;
      renderTeamRows();
      clearTimeout(teamState.timer);
      teamState.timer = window.setTimeout(() => { teamState.loading = false; renderTeamRows(); document.querySelector('[data-team-search]')?.focus(); }, 280);
    }
    if (input.matches('[data-transaction-query]')) transactionState.query = input.value;
    if (input.matches('[data-account-query]')) {
      accountState.query = input.value;
      accountState.page = 1;
      accountState.loading = true;
      renderAccountTable();
      clearTimeout(accountState.timer);
      accountState.timer = window.setTimeout(() => { accountState.loading = false; renderAccountTable(); }, 280);
    }
    if (input.matches('[data-users-query]')) usersState.query = input.value;
    if (input.matches('[data-orders-query]')) ordersState.query = input.value;
    if (input.matches('[data-api-search]')) {
      apiState.query = input.value;
      renderApiKeysTable();
    }
  });

  document.addEventListener('change', event => {
    if (event.target.matches('[data-page-action="transaction-page-size"]')) {
      transactionState.pageSize = Number(event.target.value);
      transactionState.page = 1;
      transactionState.selected.clear();
      renderTransactionTable();
    }
    if (event.target.matches('[data-page-action="account-page-size"]')) {
      accountState.pageSize = Number(event.target.value);
      accountState.page = 1;
      accountState.selected.clear();
      renderAccountTable();
    }
    if (event.target.matches('[data-page-action="users-page-size"]')) {
      usersState.pageSize = Number(event.target.value);
      usersState.page = 1;
      usersState.selected.clear();
      renderUsersTable();
    }
    if (event.target.matches('[data-page-action="orders-page-size"]')) {
      ordersState.pageSize = Number(event.target.value);
      ordersState.page = 1;
      renderOrdersTable();
    }
    if (event.target.matches('[data-page-action="audit-page-size"]')) {
      auditState.pageSize = Number(event.target.value);
      auditState.page = 1;
      renderAuditTable();
    }
  });

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!['invite-member-form','change-role-form','manage-roles-form','change-tier-form','create-api-key-form','new-account-form'].includes(form.id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (form.id === 'invite-member-form') {
      const name = form.elements.name;
      const email = form.elements.email;
      const role = form.elements.role;
      if (name.value.trim().length < 2) return showFieldError(name, 'Enter the member’s full name.');
      if (!email.checkValidity()) return showFieldError(email, 'Enter a valid email address.');
      if (teamState.members.some(member => member.email.toLowerCase() === email.value.trim().toLowerCase())) return showFieldError(email, 'This email is already a workspace member.');
      if (!role.value) return showFieldError(role, 'Select a starting role.');
      const submit = document.querySelector('[form="invite-member-form"]');
      submit.disabled = true;
      submit.innerHTML = '<i class="spinner"></i> Sending…';
      window.setTimeout(() => {
        teamState.members.push({ id: `member-${Date.now()}`, name: name.value.trim(), email: email.value.trim(), role: role.value, lastLogin: 'Invitation pending', twoFactor: false });
        persistMembers();
        closeOverlay();
        window.setTimeout(() => { if (state.tab === 'team') renderTeam(); }, closeAnimationMs);
        notify(`An invitation was sent to ${email.value.trim()}.`, 'success', { title: 'Member invited' });
      }, 650);
    }
    if (form.id === 'change-role-form') {
      const member = teamState.members.find(item => item.id === form.dataset.memberId);
      const select = form.querySelector('select');
      if (!member || !select.value) return showFieldError(select, 'Select a role.');
      const submit = document.querySelector('[form="change-role-form"]');
      submit.disabled = true;
      submit.innerHTML = '<i class="spinner"></i> Updating…';
      window.setTimeout(() => {
        member.role = select.value;
        persistMembers();
        closeOverlay();
        window.setTimeout(renderTeam, closeAnimationMs);
        notify(`${member.name} is now ${member.role}.`, 'success', { title: 'Role updated' });
      }, 520);
    }
    if (form.id === 'manage-roles-form') {
      const submit = document.querySelector('[form="manage-roles-form"]');
      submit.disabled = true;
      submit.innerHTML = '<i class="spinner"></i> Saving…';
      window.setTimeout(() => { closeOverlay(); notify('Workspace role availability was updated.', 'success', { title: 'Roles saved' }); }, 500);
    }
    if (form.id === 'change-tier-form') {
      const user = users.find(item => item.id === form.dataset.userId);
      const select = form.querySelector('select');
      if (!user || !select.value) return showFieldError(select, 'Select a plan.');
      const submit = document.querySelector('[form="change-tier-form"]');
      submit.disabled = true;
      submit.innerHTML = '<i class="spinner"></i> Updating…';
      window.setTimeout(() => {
        user.tier = select.value;
        closeOverlay();
        window.setTimeout(renderUsersTable, closeAnimationMs);
        notify(`${user.name} is now on the ${user.tier} plan.`, 'success', { title: 'Plan updated' });
      }, 520);
    }
    if (form.id === 'create-api-key-form') {
      const name = form.elements.name;
      const environment = form.elements.environment;
      if (name.value.trim().length < 2) return showFieldError(name, 'Enter a name for this key.');
      const submit = document.querySelector('[form="create-api-key-form"]');
      submit.disabled = true;
      submit.innerHTML = '<i class="spinner"></i> Generating…';
      window.setTimeout(() => {
        const chars = 'abcdef0123456789';
        const secret = `wy_${environment.value.toLowerCase()}_${Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}`;
        const key = { id: `key-${Date.now()}`, name: name.value.trim(), environment: environment.value, prefix: secret.slice(0, 12), created: new Date().toLocaleDateString('en-GB').split('/').join('-'), lastUsed: 'Not used yet', status: 'Active' };
        apiKeys.unshift(key);
        closeOverlay();
        window.setTimeout(() => { renderApiKeysTable(); revealApiKeyModal(key, secret); }, closeAnimationMs);
      }, 550);
    }
    if (form.id === 'new-account-form') {
      const nameInput = form.elements.accountName;
      const typeInput = form.elements.accountType;
      const currencyInput = form.elements.accountCurrency;
      const fundingInput = form.elements.accountFunding;
      if (nameInput.value.trim().length < 2) return showFieldError(nameInput, 'Enter an account name.');
      if (!typeInput.value) return showFieldError(typeInput, 'Select an account type.');
      if (!currencyInput.value) return showFieldError(currencyInput, 'Select a base currency.');
      if (!fundingInput.value) return showFieldError(fundingInput, 'Select a funding source.');
      const submit = document.querySelector('#new-account-submit');
      submit.disabled = true;
      submit.innerHTML = '<i class="spinner"></i> Creating account…';
      window.setTimeout(() => {
        notify(`${nameInput.value.trim()} was created.`, 'success', { title: 'Account created' });
        location.hash = '/business-trading';
      }, 700);
    }
  }, true);

  document.addEventListener('click', event => {
    const action = event.target.closest('[data-page-action]');
    const memberAction = event.target.closest('[data-member-action]');
    const userAction = event.target.closest('[data-user-action]');
    const apiAction = event.target.closest('[data-api-action]');

    if (rowMenu && !event.target.closest('.table-row-menu') && !event.target.closest('[data-page-action="member-menu"]') && !event.target.closest('[data-page-action="user-menu"]') && !event.target.closest('[data-page-action="api-menu"]') && !event.target.closest('[data-page-action="audit-menu"]')) closeRowMenu(false);
    if (homeState.rangeOpen && !event.target.closest('.home-range-wrap') && currentRoute() === '/dashboard') { homeState.rangeOpen = false; homeHeadingActions(); }
    if (reportState.rangeOpen && !event.target.closest('.home-range-wrap') && currentRoute() === '/reports') { reportState.rangeOpen = false; reportHeadingActions(); }
    if (transactionState.filterOpen && !event.target.closest('.table-filter-wrap') && currentRoute() === '/transactions') { closeFilter('transactions'); transactionHeadingActions(); }
    if (accountState.filterOpen && !event.target.closest('.table-filter-wrap') && currentRoute() === '/account') { accountState.filterOpen = false; renderAccountFilter(); }
    if (teamState.filterOpen && !event.target.closest('.table-filter-wrap') && state.tab === 'team') { closeFilter('team'); renderTeam(); }
    if (usersState.filterOpen && !event.target.closest('.table-filter-wrap') && currentRoute() === '/users') { usersState.filterOpen = false; usersHeadingActions(); }
    if (ordersState.filterOpen && !event.target.closest('.table-filter-wrap') && currentRoute() === '/orders') { ordersState.filterOpen = false; ordersHeadingActions(); }
    if (auditState.filterOpen && !event.target.closest('.table-filter-wrap') && currentRoute() === '/audit-log') { auditState.filterOpen = false; auditHeadingActions(); }

    if (memberAction) {
      event.preventDefault();
      const member = teamState.members.find(item => item.id === memberAction.dataset.id);
      const kind = memberAction.dataset.memberAction;
      closeRowMenu(false);
      if (!member) return;
      if (kind === 'enforce') {
        const id = notify(`Updating ${member.name}’s security policy.`, 'loading', { title: 'Enforcing 2FA', duration: 0, progress: 24 });
        return window.setTimeout(() => { member.twoFactor = true; persistMembers(); renderTeamRows(); updateNotice(id, { type: 'success', title: '2FA enforced', message: `${member.name} must use two-factor authentication.`, duration: 4500, progress: 100 }); }, 650);
      }
      if (kind === 'reset') return notify(`A reset link would be sent to ${member.email} through the authenticated service.`, 'info', { title: 'Password reset prepared' });
      if (kind === 'role') return changeRoleModal(member);
      if (kind === 'remove') { pendingRemoval = member.id; return openConfirm('Remove member?', 'This removes workspace access immediately.', `${member.name} will lose access to this workspace.`, 'Remove member', 'confirm-remove-member', true); }
    }

    if (userAction) {
      event.preventDefault();
      const user = users.find(item => item.id === userAction.dataset.id);
      const kind = userAction.dataset.userAction;
      closeRowMenu(false);
      if (!user) return;
      if (kind === 'view') return userProfileModal(user);
      if (kind === 'reset') return notify(`A reset link would be sent to ${user.email} through the authenticated service.`, 'info', { title: 'Password reset prepared' });
      if (kind === 'tier') return changeTierModal(user);
      if (kind === 'toggle-status') {
        const next = user.status === 'Suspended' ? 'Active' : 'Suspended';
        const id = notify(`Updating ${user.name}’s account status.`, 'loading', { title: next === 'Suspended' ? 'Suspending user' : 'Reactivating user', duration: 0, progress: 30 });
        return window.setTimeout(() => { user.status = next; renderUsersTable(); updateNotice(id, { type: 'success', title: next === 'Suspended' ? 'User suspended' : 'User reactivated', message: `${user.name} is now ${next.toLowerCase()}.`, duration: 4500, progress: 100 }); }, 600);
      }
      if (kind === 'remove') return openConfirm('Remove user?', 'This removes the user’s access to the platform immediately.', `${user.name} will lose access to this workspace.`, 'Remove user', `confirm-remove-user-${user.id}`, true);
    }

    if (apiAction) {
      event.preventDefault();
      const key = apiKeys.find(item => item.id === apiAction.dataset.id);
      const kind = apiAction.dataset.apiAction;
      closeRowMenu(false);
      if (!key) return;
      if (kind === 'copy') { apiState.revealedKeyId = key.id; renderApiKeysTable(); return notify(`${key.prefix}•••• copied to clipboard.`, 'success', { title: 'Key copied' }); }
      if (kind === 'roll') return openConfirm('Roll this key?', 'The current key stops working immediately once a new one is issued.', `${key.name} will be replaced with a new key.`, 'Roll key', `confirm-roll-key-${key.id}`, true);
      if (kind === 'revoke') return openConfirm('Revoke this key?', 'Any service using this key will lose access immediately.', `${key.name} will be revoked.`, 'Revoke key', `confirm-revoke-key-${key.id}`, true);
    }

    if (!action) return;
    const kind = action.dataset.pageAction;
    if (kind === 'toggle-home-range') { homeState.rangeOpen = !homeState.rangeOpen; return homeHeadingActions(); }
    if (kind === 'select-home-range') {
      homeState.range = action.dataset.range;
      homeState.rangeOpen = false;
      homeState.loading = true;
      clearTimeout(homeState.timer);
      renderHome();
      homeState.timer = window.setTimeout(() => { homeState.loading = false; if (currentRoute() === '/dashboard') renderHome(); }, dataDelay);
      return;
    }
    if (kind === 'download-home') {
      const data = homeRanges[homeState.range];
      const noticeId = notify('Preparing the dashboard summary.', 'loading', { title: 'Download in progress', duration: 0, progress: 28 });
      return window.setTimeout(() => {
        try {
          const rows = [['Metric','Value','Change'], ...data.metrics.map(([label, value, change]) => [label, value, change])];
          const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
          const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
          const anchor = Object.assign(document.createElement('a'), { href: url, download: `home-dashboard-${homeState.range}-days.csv` });
          anchor.click();
          URL.revokeObjectURL(url);
          updateNotice(noticeId, { type: 'success', title: 'Dashboard downloaded', message: 'The summary CSV is ready.', duration: 4500, progress: 100 });
        } catch {
          updateNotice(noticeId, { type: 'error', title: 'Download failed', message: 'The summary could not be created. Try again.', duration: 6500, progress: null });
        }
      }, 620);
    }
    if (kind === 'open-api-dashboard') { location.hash = '/api'; return; }
    if (kind === 'toggle-account-filter') { accountState.filterOpen = !accountState.filterOpen; return renderAccountFilter(); }
    if (kind === 'close-account-filter') { accountState.filterOpen = false; accountState.page = 1; renderAccountFilter(); return renderAccountTable(); }
    if (kind === 'account-filter') { accountState[action.dataset.group] = action.dataset.value; accountState.page = 1; return renderAccountFilter(); }
    if (kind === 'reset-account-filter') { accountState.query = ''; accountState.status = 'all'; accountState.direction = 'all'; accountState.page = 1; const field = document.querySelector('[data-account-query]'); if (field) field.value = ''; renderAccountFilter(); return renderAccountTable(); }
    if (kind === 'retry-account') { accountState.error = false; accountState.loading = true; renderAccountTable(); return window.setTimeout(() => { accountState.loading = false; renderAccountTable(); }, dataDelay); }
    if (kind === 'account-page') return changeAccountPage(action.dataset.page);
    if (kind === 'select-account-transaction') { const id = action.dataset.id; accountState.selected.has(id) ? accountState.selected.delete(id) : accountState.selected.add(id); return renderAccountTable(); }
    if (kind === 'select-visible-account-transactions') { const rows = filteredAccountTransactions().slice((accountState.page - 1) * accountState.pageSize, accountState.page * accountState.pageSize); const all = rows.every(row => accountState.selected.has(row.id)); rows.forEach(row => all ? accountState.selected.delete(row.id) : accountState.selected.add(row.id)); return renderAccountTable(); }
    if (kind === 'clear-account-selection') { accountState.selected.clear(); return renderAccountTable(); }
    if (kind === 'download-account' || kind === 'download-selected-account') {
      const rows = kind === 'download-account' ? filteredAccountTransactions() : accountTransactions.filter(row => accountState.selected.has(row.id));
      return downloadCsv(kind === 'download-account' ? 'account-transactions.csv' : 'selected-account-transactions.csv', ['Transaction ID', 'Direction', 'From / To', 'Status', 'Date', 'Amount'], rows.map(row => [row.id, row.direction, row.counterparty, row.status, row.date, row.amount]));
    }
    if (kind === 'copy-account-detail') return copyAccountValue(action.dataset.label, action.dataset.value, `${action.dataset.label} copied to the clipboard.`);
    if (kind === 'copy-account-details') return copyAccountValue('all', accountDetailText(), 'Every account detail was copied to the clipboard.');
    if (kind === 'refresh-balance') {
      if (action.classList.contains('is-busy')) return;
      action.classList.add('is-busy');
      action.setAttribute('aria-busy', 'true');
      return window.setTimeout(() => {
        action.classList.remove('is-busy');
        action.removeAttribute('aria-busy');
        notify('This preview re-reads the local balance. A connected banking service is required for live values.', 'info', { title: 'Balance refreshed' });
      }, 620);
    }
    if (kind === 'toggle-transaction-filter') { transactionState.filterOpen = !transactionState.filterOpen; return transactionHeadingActions(); }
    if (kind === 'close-transaction-filter') { transactionState.filterOpen = false; transactionState.page = 1; transactionHeadingActions(); return renderTransactionTable(); }
    if (kind === 'transaction-filter') { transactionState[action.dataset.group] = action.dataset.value; transactionState.page = 1; return transactionHeadingActions(); }
    if (kind === 'reset-transaction-filter') { transactionState.query = ''; transactionState.status = 'all'; transactionState.direction = 'all'; transactionState.page = 1; transactionHeadingActions(); return renderTransactionTable(); }
    if (kind === 'retry-transactions') { transactionState.error = false; transactionState.loading = true; renderTransactionTable(); return window.setTimeout(() => { transactionState.loading = false; renderTransactionTable(); }, dataDelay); }
    if (kind === 'download-transactions') return csvDownload(filteredTransactions(), 'transactions.csv');
    if (kind === 'download-selected') return csvDownload(selectedTransactions(), 'selected-transactions.csv');
    if (kind === 'transaction-page') return changeTransactionPage(action.dataset.page);
    if (kind === 'select-transaction') { transactionState.selected.has(action.dataset.id) ? transactionState.selected.delete(action.dataset.id) : transactionState.selected.add(action.dataset.id); return renderTransactionTable(); }
    if (kind === 'select-visible-transactions') { const rows = filteredTransactions().slice((transactionState.page - 1) * transactionState.pageSize, transactionState.page * transactionState.pageSize); const all = rows.every(row => transactionState.selected.has(row.id)); rows.forEach(row => all ? transactionState.selected.delete(row.id) : transactionState.selected.add(row.id)); return renderTransactionTable(); }
    if (kind === 'flag-selected') return openConfirm('Flag selected users?', 'Flagging adds an internal review status.', `${transactionState.selected.size} selected users will be flagged for review.`, 'Flag users', 'confirm-flag-users');
    if (kind === 'freeze-selected') return openConfirm('Freeze selected users?', 'Frozen users cannot initiate new transactions.', `${transactionState.selected.size} selected users will be frozen.`, 'Freeze users', 'confirm-freeze-users', true);
    if (kind === 'deactivate-selected') return openConfirm('Deactivate selected users?', 'Deactivation removes access until an administrator restores it.', `${transactionState.selected.size} selected users will be deactivated.`, 'Deactivate users', 'confirm-deactivate-users', true);
    if (['confirm-flag-users','confirm-freeze-users','confirm-deactivate-users'].includes(kind)) { const count = transactionState.selected.size; const label = kind.includes('flag') ? 'flagged' : kind.includes('freeze') ? 'frozen' : 'deactivated'; closeOverlay(); transactionState.selected.clear(); window.setTimeout(renderTransactionTable, closeAnimationMs); return notify(`${count} users were ${label}.`, kind.includes('flag') ? 'warning' : 'success', { title: 'Bulk action complete', actionLabel: 'Undo', onAction: () => notify('The bulk action was reversed.', 'info', { title: 'Action undone' }) }); }
    if (kind === 'toggle-team-filter') { teamState.filterOpen = !teamState.filterOpen; return renderTeam(); }
    if (kind === 'close-team-filter') { teamState.filterOpen = false; return renderTeam(); }
    if (kind === 'team-filter') { teamState.twoFactor = action.dataset.value; return renderTeam(); }
    if (kind === 'reset-team-filter') { teamState.query = ''; teamState.twoFactor = 'all'; teamState.filterOpen = false; return renderTeam(); }
    if (kind === 'select-member') { teamState.selected.has(action.dataset.id) ? teamState.selected.delete(action.dataset.id) : teamState.selected.add(action.dataset.id); return renderTeamRows(); }
    if (kind === 'select-visible-members') { const members = filteredMembers(); const all = members.every(member => teamState.selected.has(member.id)); members.forEach(member => all ? teamState.selected.delete(member.id) : teamState.selected.add(member.id)); return renderTeamRows(); }
    if (kind === 'member-menu') { const member = teamState.members.find(item => item.id === action.dataset.id); if (member) openRowMenu(action, member); return; }
    if (kind === 'invite-member') return inviteMemberModal();
    if (kind === 'manage-roles') return manageRolesModal();
    if (kind === 'enforce-two-factor') { const targets = teamState.selected.size ? teamState.members.filter(member => teamState.selected.has(member.id)) : teamState.members.filter(member => !member.twoFactor); if (!targets.length) return notify('Every member already has two-factor authentication enabled.', 'info', { title: '2FA already enforced' }); return openConfirm('Enforce two-factor authentication?', 'Members will be prompted during their next sign-in.', `${targets.length} member${targets.length === 1 ? '' : 's'} will be required to set up 2FA.`, 'Enforce 2FA', 'confirm-enforce-two-factor'); }
    if (kind === 'confirm-enforce-two-factor') { const targets = teamState.selected.size ? teamState.members.filter(member => teamState.selected.has(member.id)) : teamState.members.filter(member => !member.twoFactor); closeOverlay(); const id = notify('Updating workspace security requirements.', 'loading', { title: 'Enforcing 2FA', duration: 0, progress: 30 }); return window.setTimeout(() => { targets.forEach(member => member.twoFactor = true); teamState.selected.clear(); persistMembers(); renderTeamRows(); updateNotice(id, { type: 'success', title: '2FA enforced', message: `${targets.length} members were updated.`, duration: 4500, progress: 100 }); }, 700); }
    if (kind === 'confirm-remove-member') { const member = teamState.members.find(item => item.id === pendingRemoval); closeOverlay(); if (!member) return; const id = notify(`Removing ${member.name} from the workspace.`, 'loading', { title: 'Removing member', duration: 0, progress: 35 }); return window.setTimeout(() => { teamState.members = teamState.members.filter(item => item.id !== member.id); teamState.selected.delete(member.id); pendingRemoval = null; persistMembers(); renderTeamRows(); updateNotice(id, { type: 'success', title: 'Member removed', message: `${member.name} no longer has workspace access.`, duration: 5000, progress: 100 }); }, 620); }

    // ---------- Users ----------
    if (kind === 'toggle-users-filter') { usersState.filterOpen = !usersState.filterOpen; return usersHeadingActions(); }
    if (kind === 'close-users-filter') { usersState.filterOpen = false; usersState.page = 1; usersHeadingActions(); return renderUsersTable(); }
    if (kind === 'users-filter') { usersState.status = action.dataset.value; usersState.page = 1; return usersHeadingActions(); }
    if (kind === 'reset-users-filter') { usersState.query = ''; usersState.status = 'all'; usersState.page = 1; usersHeadingActions(); return renderUsersTable(); }
    if (kind === 'retry-users') { usersState.error = false; usersState.loading = true; renderUsersTable(); return window.setTimeout(() => { usersState.loading = false; renderUsersTable(); }, dataDelay); }
    if (kind === 'download-users') return downloadCsv('users.csv', ['User ID', 'Name', 'Email', 'Plan', 'Status', 'Orders', 'Joined'], filteredUsers().map(user => [user.id, user.name, user.email, user.tier, user.status, user.orders, user.joined]));
    if (kind === 'users-page') { changeGenericPage(usersState, filteredUsers().length, action.dataset.page); usersState.loading = true; renderUsersTable(); return window.setTimeout(() => { usersState.loading = false; renderUsersTable(); document.querySelector('#users-data')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 300); }
    if (kind === 'select-user') { usersState.selected.has(action.dataset.id) ? usersState.selected.delete(action.dataset.id) : usersState.selected.add(action.dataset.id); return renderUsersTable(); }
    if (kind === 'select-visible-users') { const rows = filteredUsers().slice((usersState.page - 1) * usersState.pageSize, usersState.page * usersState.pageSize); const all = rows.every(row => usersState.selected.has(row.id)); rows.forEach(row => all ? usersState.selected.delete(row.id) : usersState.selected.add(row.id)); return renderUsersTable(); }
    if (kind === 'user-menu') { const user = users.find(item => item.id === action.dataset.id); if (user) openUserMenu(action, user); return; }
    if (kind === 'flag-selected-users') return openConfirm('Flag selected users?', 'Flagging adds an internal review status.', `${usersState.selected.size} selected users will be flagged for review.`, 'Flag users', 'confirm-flag-selected-users');
    if (kind === 'freeze-selected-users') return openConfirm('Freeze selected users?', 'Frozen users cannot place new orders.', `${usersState.selected.size} selected users will be frozen.`, 'Freeze users', 'confirm-freeze-selected-users', true);
    if (kind === 'deactivate-selected-users') return openConfirm('Deactivate selected users?', 'Deactivation removes access until an administrator restores it.', `${usersState.selected.size} selected users will be deactivated.`, 'Deactivate users', 'confirm-deactivate-selected-users', true);
    if (['confirm-flag-selected-users', 'confirm-freeze-selected-users', 'confirm-deactivate-selected-users'].includes(kind)) {
      const count = usersState.selected.size;
      const label = kind.includes('flag') ? 'flagged' : kind.includes('freeze') ? 'frozen' : 'deactivated';
      closeOverlay();
      if (kind.includes('deactivate')) users.forEach(user => { if (usersState.selected.has(user.id)) user.status = 'Suspended'; });
      usersState.selected.clear();
      window.setTimeout(renderUsersTable, closeAnimationMs);
      return notify(`${count} users were ${label}.`, kind.includes('flag') ? 'warning' : 'success', { title: 'Bulk action complete' });
    }
    if (kind.startsWith('confirm-remove-user-')) {
      const userId = kind.replace('confirm-remove-user-', '');
      const index = users.findIndex(item => item.id === userId);
      closeOverlay();
      if (index === -1) return;
      const [removed] = users.splice(index, 1);
      usersState.selected.delete(userId);
      window.setTimeout(renderUsersTable, closeAnimationMs);
      return notify(`${removed.name} no longer has platform access.`, 'success', { title: 'User removed' });
    }

    // ---------- Orders ----------
    if (kind === 'toggle-orders-filter') { ordersState.filterOpen = !ordersState.filterOpen; return ordersHeadingActions(); }
    if (kind === 'close-orders-filter') { ordersState.filterOpen = false; ordersState.page = 1; ordersHeadingActions(); return renderOrdersTable(); }
    if (kind === 'orders-filter') { ordersState[action.dataset.group] = action.dataset.value; ordersState.page = 1; return ordersHeadingActions(); }
    if (kind === 'reset-orders-filter') { ordersState.query = ''; ordersState.status = 'all'; ordersState.type = 'all'; ordersState.page = 1; ordersHeadingActions(); return renderOrdersTable(); }
    if (kind === 'retry-orders') { ordersState.error = false; ordersState.loading = true; renderOrdersTable(); return window.setTimeout(() => { ordersState.loading = false; renderOrdersTable(); }, dataDelay); }
    if (kind === 'download-orders') return downloadCsv('orders.csv', ['Order ID', 'Customer', 'Type', 'Instrument', 'Status', 'Amount', 'Date'], filteredOrders().map(order => [order.id, order.name, order.type, order.instrument, order.status, order.amount, order.date]));
    if (kind === 'orders-page') { changeGenericPage(ordersState, filteredOrders().length, action.dataset.page); ordersState.loading = true; renderOrdersTable(); return window.setTimeout(() => { ordersState.loading = false; renderOrdersTable(); document.querySelector('#orders-data')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 300); }

    // ---------- Audit log ----------
    if (kind === 'toggle-audit-filter') {
      auditState.filterOpen = !auditState.filterOpen;
      return auditHeadingActions();
    }
    if (kind === 'close-audit-filter') { auditState.filterOpen = false; auditState.page = 1; auditHeadingActions(); return renderAuditTable(); }
    if (kind === 'reset-audit-filter') return resetAuditFilters();
    if (kind === 'audit-filter') { if (!['activity', 'role', 'date'].includes(action.dataset.group)) return; auditState[action.dataset.group] = action.dataset.value; auditState.page = 1; auditHeadingActions(); renderAuditAppliedFilters(); return renderAuditTable(); }
    if (kind === 'remove-audit-filter') { if (!['activity', 'role', 'date'].includes(action.dataset.group)) return; auditState[action.dataset.group] = ''; auditState.page = 1; auditHeadingActions(); renderAuditAppliedFilters(); return renderAuditTable(); }
    if (kind === 'open-audit') return openAuditDrawer(action.dataset.id, action);
    if (kind === 'close-audit-drawer') return closeAuditDrawer();
    if (kind === 'step-audit') return stepAuditEvent(action.dataset.step);
    if (kind === 'open-audit-target') { const entry = auditLog.find(item => item.id === action.dataset.id); return notify(`${entry ? entry.target.name || entry.target.label : 'This record'} opens in the host application.`, 'info', { title: 'Target record' }); }
    if (kind === 'copy-audit-value') return copyAuditValue(action.dataset.label, action.dataset.value);
    if (kind === 'select-audit') { const id = action.dataset.id; auditState.selected.has(id) ? auditState.selected.delete(id) : auditState.selected.add(id); return renderAuditTable(); }
    if (kind === 'select-visible-audit') { const rows = filteredAudit().slice((auditState.page - 1) * auditState.pageSize, auditState.page * auditState.pageSize); const all = rows.every(entry => auditState.selected.has(entry.id)); rows.forEach(entry => all ? auditState.selected.delete(entry.id) : auditState.selected.add(entry.id)); return renderAuditTable(); }
    if (kind === 'clear-audit-selection') { auditState.selected.clear(); return renderAuditTable(); }
    if (kind === 'download-audit' || kind === 'download-audit-window' || kind === 'download-selected-audit') {
      const rows = kind === 'download-selected-audit' ? auditLog.filter(entry => auditState.selected.has(entry.id)) : filteredAudit();
      return downloadCsv(kind === 'download-selected-audit' ? 'selected-audit-events.csv' : 'audit-log.csv', ['Log ID', 'Event ID', 'Date / Time', 'Member', 'Activity', 'Target', 'Role', 'Location', 'IP address', 'Status'], rows.map(entry => [entry.id, entry.eventId, entry.date, entry.actorName, `${entry.verb} ${entry.object}`, entry.target.label, entry.role, entry.location, entry.ip, entry.status]));
    }
    if (kind === 'audit-page') { changeGenericPage(auditState, filteredAudit().length, action.dataset.page); auditState.loading = true; renderAuditTable(); return window.setTimeout(() => { auditState.loading = false; renderAuditTable(); document.querySelector('#audit-data')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 300); }

    // ---------- API ----------
    if (kind === 'create-api-key') return createApiKeyModal();
    if (kind === 'copy-new-api-key') { navigator.clipboard?.writeText(action.dataset.secret || '').catch(() => {}); return notify('The key was copied to your clipboard.', 'success', { title: 'Key copied' }); }
    if (kind.startsWith('confirm-roll-key-')) {
      const keyId = kind.replace('confirm-roll-key-', '');
      const key = apiKeys.find(item => item.id === keyId);
      closeOverlay();
      if (!key) return;
      const id = notify(`Rolling ${key.name}.`, 'loading', { title: 'Rolling key', duration: 0, progress: 30 });
      return window.setTimeout(() => {
        key.prefix = `wy_${key.environment.toLowerCase()}_${Math.random().toString(16).slice(2, 6)}`;
        key.created = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).split('/').join('-');
        key.lastUsed = 'Not used yet';
        renderApiKeysTable();
        updateNotice(id, { type: 'success', title: 'Key rolled', message: `${key.name} now uses a new secret.`, duration: 4500, progress: 100 });
      }, 650);
    }
    if (kind.startsWith('confirm-revoke-key-')) {
      const keyId = kind.replace('confirm-revoke-key-', '');
      const key = apiKeys.find(item => item.id === keyId);
      closeOverlay();
      if (!key) return;
      key.status = 'Revoked';
      window.setTimeout(renderApiKeysTable, closeAnimationMs);
      return notify(`${key.name} was revoked.`, 'success', { title: 'Key revoked' });
    }

    // ---------- Report ----------
    if (kind === 'toggle-report-range') { reportState.rangeOpen = !reportState.rangeOpen; return reportHeadingActions(); }
    if (kind === 'select-report-range') {
      reportState.range = action.dataset.range;
      reportState.rangeOpen = false;
      reportState.loading = true;
      clearTimeout(reportState.timer);
      renderReport();
      reportState.timer = window.setTimeout(() => { reportState.loading = false; if (currentRoute() === '/reports') renderReport(); }, dataDelay);
      return;
    }
    if (kind === 'download-report') {
      const data = reportRanges[reportState.range];
      return downloadCsv(`report-${reportState.range}-days.csv`, ['Metric', 'Value', 'Change'], data.metrics.map(([label, value, change]) => [label, value, change]));
    }

    // ---------- Business trading / New account ----------
    if (kind === 'open-new-account') { location.hash = '/accounts/new'; return; }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeRowMenu(true);
      if (auditState.filterOpen) { auditState.filterOpen = false; auditHeadingActions(); }
      if (auditState.openId) closeAuditDrawer();
    }
    if (rowMenu && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      const items = [...rowMenu.querySelectorAll('button')];
      if (!items.length) return;
      event.preventDefault();
      const current = Math.max(0, items.indexOf(document.activeElement));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }
  }, true);

  addEventListener('hashchange', render);
  addEventListener('resize', () => closeRowMenu(false));
  render();
})();
