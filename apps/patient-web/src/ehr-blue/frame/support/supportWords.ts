/**
 * English words that use only Health ID letters (no i or o), so the privacy guard can tell a word typed after HID
 * from a Health ID: "Health ID handles referrals" and "HID CHARGED US TWICE" are questions, "HID kqzxtw" is not.
 * A word counts with the common English endings and the prefixes "un" and "re": "charge" gives "charged",
 * "charges" and "recharge"; "sudden" gives "suddenly"; "read" gives "unread".
 *
 * The list is common English (verbs, nouns, adjectives, adverbs), with health, billing and software words, product
 * names and Nigerian states and towns added, each word once in its shortest form. A word not on it is read as a
 * possible Health ID (privacy first): add it here. Each word costs almost nothing in privacy: a random Health ID of 6
 * letters is one given word about once in 191 million (24 to the power 6). With every ending the list reads about
 * 7,000 six-letter strings as words, so about one 6-character Health ID in 150,000, typed straight after HID, is read
 * as a word and sent.
 */

/** Whether a word, in any case, is an English word on the list or one of its forms. */
export function isEnglishWord(word: string): boolean {
  const lower = word.toLowerCase()
  return ['', 'un', 're'].some(start => lower.startsWith(start) && ENDINGS.some(ending => {
    const rest = lower.slice(start.length)
    if (!rest.endsWith(ending)) return false
    const stem = rest.slice(0, rest.length - ending.length)
    // A doubled last letter goes with its ending: "flagged" is "flag", "planned" is "plan".
    return WORDS.has(stem) || (/(.)\1$/.test(stem) && WORDS.has(stem.slice(0, -1)))
  }))
}

const ENDINGS = ['', 's', 'es', 'd', 'ed', 'edly', 'ly', 'er', 'ers', 'est', 'ment', 'ments', 'ful', 'fully', 'less', 'ness']

const WORDS: ReadonlySet<string> = new Set(`
  a aardvark able abscess absence absent absentee abstract absurd abuja abuse abysmal academy accelerate accent accept
  acceptable acceptance access accrue accumulate accuracy accurate accuse ace acer act actual actuary acupuncture
  acute adamawa adapt add addendum address addressee adequate adhere adherence adjacent adjust adjustable adult
  advance advantage advent adventure adverse advert affect after afterwards age agency agenda agent aggregate agree
  ahead ajah akure akwa alarm alas album alert algebra all allege alleged allergy ally alpha alphabet already alter
  alternate always am amateur amaze amber ambulance amend amp ampere ampersand ample amputate amuse an anagram
  analyses analyst anambra anarchy angel anger angle angry ankle annex annual annul answer antenatal antenna any
  anyplace anyway anywhere apapa apart apathy appalled apparatus apparent appeal appear appearance append appendage
  applaud applause apple apply apt arc arcade arcane arch are area arena arguable arguably argue argument arm army
  arrange array arrears arrest art artery as asaba asap ascend ash ashamed ashcan ask asleep aspect assault assemble
  assembler assembly assert assess asset assume assurance assure asthma asus asylum at ate atlas attach attack attempt
  attend attendance attendant attract augment august aunt autumn avenue average awake award aware away awful awka
  awkward axes baby back backend backlash backpack backslash backspace backtrack backup backward bad badge baffle bag
  baggage bake balance ball ballet ban banal banana band bandage bang bank bankrupt bankruptcy bar bare bark barrel
  base bash basket bass bat batch bath battery battle baud bay bayelsa be beach beam bean bear beard beast beat beaten
  beauty became because bed beef been beeper beg began begun behalf behave belated bell belt bench bend beneath bent
  benue best bet beta between beverage beware black bladder blade blame blank blanket blast blatant bleed blend bless
  blew blue blunder blurb brace bracket brake branch brand brass brave breach bread break breakfast breast breath
  breathe bred breed breeze brethren brush brutal bubble buck bucket budget buffer buffet bug bulb bulk bulky bull
  bullet bump bunch bundle bungle burden bureau bureaucracy burn burnt bursar burst bury bus bush bust busy but buy by
  bye bypass bystander byte cabbage cable cache cage cake calabar calculate calculus calendar call callable calm cam
  came camera camp campus can cancel cancer cant canteen cap capable capsule captcha capture car card care caretaker
  carpet carry cascade case cash cassette cast castle casual casualty cat cataract catch cater cathedral cattle caught
  causal cause cave caveat cease celebrate cell cellular census cent central centre century cerebral chalk challenge
  chamber champagne chance change channel chap chapel chapter char character charge chargeable charger charm chart
  chase chat cheap cheat check checkup cheek cheer cheese chess chest chestnut chew chuck chunk church clash class
  clause clean clear clearance clerk clever club clue clumsy cluster clutter crack craft cramp crash crass crawl crazy
  cream create creature creed creep crew crude cruel cruelty crunch crush crutch cry crystal css cube cuddly cue
  culpable cult cultural culture cup curable cure curfew curly currency current curry curse curve custard cut cutback
  cute cycle daft damage damaturu damns damp dance danger dare dark dash data database dataset date datum daughter
  dawn day dead deaf deal dealt dear death debatable debate debt debug decade decay december decent deck declare
  decrease decree deduce deduct deed deem deep default defeat defect defend defer deference defunct defy degenerate
  degrade degree dehydrate delay delegate delete dell delta deluxe demand demented dengue dense dental deny depart
  departmental departure depend dependable dependence dependency dependent deplete depress depth deputy derange
  descend desert deserve desk desperate detach detachable detect detectable deter detergent deterrent detract devalue
  devastate dns draft drag drama drank draw drawback drawn dread dream dreary dress drew drug drum drunk drunken dry
  dual duck due duff dug dull duly dumb dummy dump dumpster durable duress dust dusty dutse duty dysentery each eager
  eagle ear earache eardrum earmark earn earth ease east eastern easy eat eaten ecg eczema edge educate effect egg ehr
  eject ekg elapse elder eldest elect elegant element elementary elephant elevate eleven else elsewhere embark
  embarrass embassy embed emerge emergence emergency emphysema empty emr emulate enable enact encrypted end endanger
  endless endurance enema enemy energy engage enhance enlarge ensure enter entrance entrant entry enugu enumerate envy
  enzyme equal equate era erase eraser erasure err escalate escape essay essence estate eternal evacuate evaluate even
  event eventual ever every everyday everywhere exact exaggerate exam example exceed excel excellence excellent except
  excerpt excess exchange exclude excuse executable execute exempt exert exhale exhaust expand expandable expect
  expectancy expectant expel expend expendable expense expert express expressway extant extend extent external extra
  extract extreme eye face fact factual faculty fake fall fallacy fallen false fame fan fancy fantasy far farce fare
  farewell farm farther farthest fast fasten fat fatal fate father faucet fault faulty fear feat feature february fed
  federal fee feeble feed feedback feel feet fell felt female fence fender festac fetch fetus fever few flag flagrant
  flame flammable flash flashback flat flaw fleet flesh flew fluctuate fluency fluent fluffy flush flute flutterwave
  fly fracture fragment frame frank fraud freak free freelance freeway freeze freezer french frequency frequent fresh
  frustrate fry fudge fuel full fully fume fun fund fundamental funeral funny fur furry further furthest fuse fuss
  fussy future fuzzy gadget galaxy gallery gamble game gang gap garage garbage garble garden gas gasp gate gateway
  gather gauge gave gay gdpr gear gender gene general generate genre gentle gentleman gentlemen gently gesture get
  ghastly glad glance gland glandular glass glean glue grab grace grade gradual graduate graft grammar grand
  grandfather grandparent grant granular graph grasp grass grateful grave greasy great greed greedy green greet grew
  guarantee guard guess guessable guest gulf gum gun gusau gut guy gwagwalada gynae hack had half hall halt halve ham
  hamper hand handbag handle handler handshake handy hang happen happy harass hard hardback harden hardware hardy harm
  harness harsh has hash hassle hasten hasty hat hate hatred have haven hay hazard hazy he head headache headquarter
  headset health healthcare healthy heap hear heart heartbeat heartburn heat heaven heavy heel held hell helmet help
  helpdesk hence her here hereby heresy herpes herself hey html http huge human humane humble humbly hundred hung
  hungry hunt hurdle hurry hurt husband hut hyphen hyphenate jack jacket jam january jazz jeans jelly jerk jest jet
  judge jump juncture jungle junk jury just kaduna keen keep keepsake kept kernel kettle key keypad knack knee knew
  kubwa kwara lab label lacerate lack lad lady lag lake lamp lan lancet land landscape lane language lapse large
  larger largest lark larynx laser last latch late latency latent later lateral latest latex latter laugh laughter
  launch laundry law lawn lawyer lay layman laymen lazy leach lead leaf leaflet league leak leakage lean leap learn
  lease least leather leave lecture lecturer led ledger left leg legacy legal legend legendary lend length lengthen
  lengthy lens lent less lessen lest let lethal letterhead letup level lever leverage lte luck lucky luggage lukewarm
  lumber lump lumpy lunch lung lurk lust luxury lymph mad madam made make maker makeup malady male man manage
  manageable manager mandate mangle mantle manual manufacture manufacturer many map march mark market marketable
  marketplace markup marry mask mass massage master mastery match mate maternal matter mattress mature may maybe maze
  mdcn me meal mean meant measles measurable measure meat medal meet megabyte melt member membrane men mend menstrual
  menstruate mental menu merchant mercury mercy mere merge merger merry mess message messenger messy met metal mtn
  much muck mucus mud muddle mug mum mumble mummy mumps mundane murder murmur muscle muscular museum must mutant
  mutate mutter mutual my myself mystery myth nafdac nah naked name namesake narrate nasal nasarawa nasty natural
  nature naughty nausea nauseate navel ndpa ndpr near nearby neat necessary neck necklace need needle needless needy
  negate neglect nephew nerve nest net neural neutral never nevertheless new newsagents newsletter newspaper next
  nsukka nuclear nucleus null numb number numeral numerate nun nurse nursery nurture nut pace pacemaker pack package
  packet pad page pager palace palatable pale palpable pamphlet pan pancreas panel pant paper paperback par parade
  paragraph parallel parameter paraphrase parcel parent parental parentheses park parse part partner party pass
  passable passage passenger passkey past paste pat patch patent path pathway pattern pause pavement pay payable
  paystack pcr peace peak peanut peasant pedal pedant pedantry peer pen penal penalty pence penetrate penny per
  percent percentage perfect perhaps perjury permanence permanent perpetual perplex persecute persevere persuade
  perusal peruse perverse pet petty pharmacy phase phrase place placenta plague plan plane planet planetary plant
  plasma plaster plate plateau play playback plea pleasant please pleasure pledge plenty plug plummet plunge plural
  plus pray preach precede precedence precedent preclude preempt preface prefer preferable preferably preference
  pregnancy pregnant prelude premature prenatal prepare prepay presence present presentable preserve press pressure
  presumably presume pretend pretext pretty prevalence prevalent prevent preventable prudence prudent psych psyche pub
  puberty pull pulp pulsate pulse pump pun punch punctual punctuate puncture punt purchase purchaser pure purge purple
  pursue push put puzzle quadruple quantum quarrel quarter queasy queen query quest queue race rack racket radar rag
  rage rally ram rampant ran rang range rank rant rapture rare rarer rarest rash raster rat rate rather rattle rave
  raw ray re reach read readable ready real realm rear rebate reckless rectal rectangle rectangular rectum recuperate
  recurrence redeemable reduce redundancy redundant refer referee reference referendum referral reflect reflex refusal
  refute regard regress regret regrettably regular regulate rehearsal reject related relax releasable relegate
  relevance relevant reluctance reluctant remarkable remarkably remedy remnant remunerate rend render renege renewable
  renewal rent rental repeat repeatable repel repellent repent reply reputable repute rescue rescuer resemblance
  resemble respect respectable rest restaurant result resultant resume resurgence retract revamp reveal revenge
  reversal revert reward rhyme rhythm rub rude rule ruler run rung rupture rural rush rusty ruthless sack sacred sad
  sadden safe safeguard safer safest safety saga sake salary sale salesman salt salvage same sample sampler samsung
  sanctuary sand sane sang sank sarcasm sat saturate saturday sauce save saw say scale scalpel scan scandal scant
  scanty scarce scare scarf scarlet scary scatter scene scenery scent schedule scheduler scheme scrap scrape scratch
  scratchy scream screen screw scrub scum sea seal search seat secrecy secret secretary secrete sect secular secure
  sedate sedentary see seek seem seen segment segregate select self sell semester senate send sense sent sentence
  separate september sequel sequence sequencer serum servant serve server set setback settable settle settler setup
  seven seventeen seventeenth seventh seventy sever several severance severe sewage sexes sexual shade shaft shake
  shaken shaky shall shame shape share sharp shatter shave she shed sheep sheet shelf shell shelter shelve shred
  shudder shuffle shunt shut shuttle shy sketch skull sky skype slack slacken slag slander slang slash slave sleep
  slept slump small smart smash smear smell smelly smug snack snag sneak sneaky sneeze space spam span spare spasm
  speak spectacular spectrum speculate sped speech speed spell spend spent sphere spleen sprang spray spread
  spreadsheet sprung spur spy sql squad square squash squeeze ssl stable stack staff stage stagger stagnant stagnate
  stake stale stalemate stall stamp stance stand standard standby staple stapler star stare stark start startle
  startup starve state status statute stay steady steal steam steel steep steer stem step steward strand strange
  stranger strangest strap strategy stratum straw stray streak stream street strength strengthen stress stretch struck
  structural structure struggle stubble stuck student study stuff stuffy stumble stun stunt style stylus subdue
  subject sublet submerge subsequent subset substance substandard subsystem subtle subtlety subtly subtract suburb
  suburban subway succeed success such sudden sue suffer sugar sugary suggest suleja sum summary sun sunburn sunday
  sundry sung sunk sunny sunscreen super superb supermarket supernatural supersede superstructure supplement
  supplementary supply suppress supreme surcharge sure surface surge surgery surname surpass surplus surrender
  surulere survey suspect suspend suspense sustenance swam swamp swap swear sweat sweep sweet swell swept swum
  syllabus symmetry sympathy synapse sync syntax syrup system tab table tablet tabulate tack tackle tactless tag take
  taken taker tale talent talk tall tally tame tamper tandem tangent tangle tank tap tape taraba target task taste
  taught tax taxable taxpayer tea teach team teammate tear teenage teenager teeth telegram telehealth tell temper
  temperature template temple tempt ten tenable tenancy tenant tend tendency tense tenth tenure term terrace terse
  test testable testament tetanus text textual texture than thank that the theater theatre theft them theme themselves
  then therapy there thereafter thereby thermal thesaurus these they thrash thread threat threaten three threw thrust
  thumb thump thursday thus trace track trade trademark trader tragedy transact transfer transferable translate
  transparency transparent transplant trap trash trashcan trauma travel tray tread treasure treasurer treasury treat
  treaty tree trek tremble trend trendy trespass truancy truck true truly trumpet truncate trunk trust trustee trusty
  truth try tube tubular tuesday tumble tumult tune tuner tunnel turbulence turn turntable tweak tweet tweezers
  twelfth twelve twenty type typeface typeset typhus ugly ulcer ultra umbrella unbearable uncle under undercut
  undergraduate underlay underneath underrate understand understandable undertake undertaken underwater underwent
  unspeakable up upbeat update upgrade upheaval upkeep uppercase upset upstream uptake upturn upward urban urge
  urgency urgent us usable usage use useful username usher usual uterus utter utterance vacancy vacant vacate vacuum
  vague valet valley valuable value valve van vary vast vat vault vegetable vehement vend venture venue verb verbal
  verge verse versus vertebra vertebrae very vessel vet veteran vpn vulnerable wade waffle wage wake walk wall wallet
  wallpaper wan wander want war warm warn warp warrant warranty wary was wash wastage waste watch water watermark wave
  wavelength waver way we weak weaken weakness wealth wealthy wear weary weasel weather webapp webcam webpage wed
  wedge wednesday week weekday weekend welfare well went were west western westward wet whale what whatever whatsapp
  wheel wheeze when whence whenever where whereas whereby wherever whether why wrap wrath wreck wreckage wren wrench
  wretched wuse xml xray yaba yard yawn yeah year yep yes yesterday yet zamfara
`.trim().split(/\s+/))
