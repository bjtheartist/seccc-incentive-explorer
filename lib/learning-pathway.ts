/**
 * lib/learning-pathway.ts — the Learning Pathway lesson set.
 *
 * This is the authored source for /learn. It replaces
 * public/learning/tier-one-lessons.html, which shipped the same three
 * modules and twelve lessons as a standalone document rendered inside an
 * iframe. Moving the prose into typed data is what makes the page's
 * claims checkable: a test can assert that twelve lessons exist, that
 * each carries exactly one correct answer, and that every official
 * source is a real URL — none of which a blob of markup allowed.
 *
 * WHAT THIS COPY IS. Every lesson is hand-authored public education.
 * Nothing here is derived from the program catalog, from zone evidence,
 * or from any per-address computation, so nothing here can drift when
 * those change. That also means nothing here may be edited casually:
 * agency names, section numbers, dates, and legal terms are quoted from
 * the linked official sources, and the page tells the reader to verify
 * with the administering agency before spending money. Registered in
 * lib/public-claim-surfaces.ts under the "reviewed-copy" contract.
 *
 * Paragraphs are span arrays rather than strings so that emphasis
 * survives the port without embedding markup in the data — a lesson body
 * can be read, diffed, and asserted on as text.
 */

/** One run of lesson text; the object forms carry emphasis. */
export type LessonSpan =
  | string
  | { readonly strong: string }
  | { readonly em: string };

/** A paragraph is an ordered run of spans. */
export type LessonParagraph = readonly LessonSpan[];

/** A link to the administering agency's own published page. */
export interface LessonSource {
  readonly label: string;
  readonly url: string;
}

export interface LessonCheckOption {
  /** Stable display marker (A/B/C) — also the option's key. */
  readonly key: "A" | "B" | "C";
  readonly text: string;
  /** Exactly one option per check carries this. */
  readonly correct?: true;
}

export interface LessonCheck {
  readonly prompt: string;
  readonly options: readonly LessonCheckOption[];
  /** Shown after answering, whichever option was picked. */
  readonly why: LessonParagraph;
}

export interface Lesson {
  /** Slug. Doubles as the DOM id, so lessons are deep-linkable. */
  readonly id: string;
  /** Display code, e.g. "L1.1". */
  readonly code: string;
  /** Owning module id. */
  readonly moduleId: string;
  readonly title: string;
  readonly minutes: number;
  readonly body: readonly LessonParagraph[];
  /**
   * How many body paragraphs are rendered before the lesson's diagram.
   * Lessons without a diagram omit it.
   */
  readonly figureAfterParagraph?: number;
  readonly check: LessonCheck;
  readonly sources: readonly LessonSource[];
}

export interface LearningModule {
  readonly id: string;
  /** 1-based position, shown as "Module N of 3". */
  readonly number: number;
  /** Short label for the sticky module tabs. */
  readonly navLabel: string;
  readonly title: string;
  readonly summary: string;
  readonly lessons: readonly Lesson[];
}

/** Repeated verbatim under every lesson's source list. */
export const LEARNING_RAILS_NOTE =
  "Reviewed August 2026 · Requirements change. Verify with the administering agency before spending money, purchasing materials, or beginning work. General public education, not legal, tax, or financial advice.";

export const LEARNING_PATHWAY_TITLE = "Learning Pathway";

export const LEARNING_PATHWAY_STANDFIRST =
  "A practical pathway for Chicago business owners and project teams. Learn who makes each decision, how to read published zoning information, and which permit or license step may come next.";

export const LEARNING_MODULES: readonly LearningModule[] = [
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "decisions",
    number: 1,
    navLabel: "01 Decisions",
    title: "Who actually decides",
    summary:
      "Separate zoning, permits, licensing, and appeals before choosing a path.",
    lessons: [
      {
        id: "zoning-is-not-a-form",
        code: "L1.1",
        moduleId: "decisions",
        title: "Zoning isn't a form you file",
        minutes: 2,
        figureAfterParagraph: 5,
        body: [
          [
            "Most people picture opening a business as a row of counters. You get your zoning at the first one, your permit at the second, your license at the third, and you walk out holding three pieces of paper. It is a tidy picture, and it sends people to City Hall for a document that does not exist.",
          ],
          [
            "Here is why. There is no line on any application that reads \"zoning approval,\" and there is no separate zoning certificate to buy. Zoning review is not a stop of its own — it is a check that happens ",
            { em: "inside" },
            " an application you were already going to file. So the useful question is never where to go for zoning. It is which application carries the zoning check for you, and that turns on one thing: ",
            { strong: "is anyone doing construction?" },
          ],
          [
            "If nobody is, because the space is ready as it stands, the zoning question gets answered inside the ",
            { strong: "business license application" },
            " at the Department of Business Affairs and Consumer Protection. The city's Zoning division reviews that application, and because it does, the license application cannot be processed until that review clears. Nothing goes to the Department of Buildings, for the plain reason that you are not building anything.",
          ],
          [
            "If someone is doing construction, the same question comes back, this time inside the ",
            { strong: "building permit application" },
            " at the Department of Buildings, where zoning is one of the reviews your plans pass through on the way to a permit.",
          ],
          [
            "Same gate, then, reached through two different doors — and the work decides which door, not the kind of business you are.",
          ],
          [
            "That one fact explains a startling number of wasted trips. Someone with no construction planned arrives at the Department of Buildings to \"get their zoning\" and gets sent away, because the department that handles construction has nothing to hand them. Someone else clears zoning for a permit and assumes licensing is settled, when the license carries a review of its own that nobody has touched. Both mistakes come out of the same picture of three counters, and both cost weeks.",
          ],
        ],
        check: {
          prompt:
            "You're opening a shop in a space that needs no construction work at all. Where does the zoning question get answered?",
          options: [
            {
              key: "A",
              text: "At the Department of Buildings, before anything else",
            },
            {
              key: "B",
              text: "Inside the business license application",
              correct: true,
            },
            {
              key: "C",
              text: "It doesn't come up, since there's no construction",
            },
          ],
          why: [
            { strong: "B." },
            " There is no separate zoning certificate to obtain. Every business license application is reviewed by the Zoning division before it can be processed. The Department of Buildings is the construction path — with no construction, you have no business there.",
          ],
        },
        sources: [
          {
            label: "Chicago Business Licensing — application requirements",
            url: "https://www.chicago.gov/city/en/sites/chicago-business-licensing/home/license-application-requirements.html",
          },
          {
            label: "BACP — zoning information",
            url: "https://www.chicago.gov/city/en/depts/bacp/supp_info/zoning.html",
          },
        ],
      },
      {
        id: "three-kinds-of-decision",
        code: "L1.2",
        moduleId: "decisions",
        title: "Three kinds of decision, three sets of manners",
        minutes: 3,
        figureAfterParagraph: 4,
        body: [
          [
            "Calling your alderman about a project is ordinary politics. Calling a Zoning Board member about your pending case is prohibited. That gap looks like a difference in etiquette, but it isn't one. It comes from a difference in what kind of decision each person is making, and once you can sort the bodies by that, most of the confusing rules stop being confusing.",
          ],
          [
            { strong: "Legislative bodies make the rules." },
            " City Council and its zoning committee change the zoning map and adopt ordinances. They are elected, or answerable to the elected, and because that is where their authority comes from, hearing from the public is the job rather than an interruption of it. Your alderman belongs to this family.",
          ],
          [
            { strong: "Administrative staff apply the rules to facts." },
            " The Zoning Administrator reads the ordinance against a specific property. Plan examiners check drawings against code. Licensing staff process applications. None of them are deciding what the rule ought to be; they are determining what it already says, which is why their answers arrive as determinations rather than positions.",
          ],
          [
            { strong: "Quasi-judicial bodies decide individual cases on a record" },
            ", the way a court does. The Zoning Board of Appeals is the one most people meet, and it hears exactly three kinds of matter: requests for variations, requests for special use approval, and appeals arguing that the Zoning Administrator got it wrong. That third one is routinely left out of popular explanations, and it is the one that matters when you believe staff misread the ordinance.",
          ],
          [
            "Now the rules follow from the classification. Because the Board decides cases rather than sets policy, it takes testimony, builds a record, and issues written resolutions — and because a decision has to rest on that record, its own Rules of Procedure prohibit ",
            { strong: "ex parte communication" },
            ", meaning contact concerning the merits or procedural posture of a case pending before it. The reason isn't that members are unfriendly. A decision resting partly on what one side said privately is not a decision on the record.",
          ],
          [
            "None of which leaves you without answers. Questions still get answered — they go to the department staff who administer the process, rather than to the people who will vote.",
          ],
        ],
        check: {
          prompt: "Which of these may be contacted about a matter currently pending?",
          options: [
            {
              key: "A",
              text: "A Zoning Board member, as long as you keep it brief",
            },
            { key: "B", text: "Your alderman", correct: true },
            { key: "C", text: "Neither, once anything has been filed" },
          ],
          why: [
            { strong: "B." },
            " Legislative officials are meant to hear from constituents. The Zoning Board is quasi-judicial, and its rules prohibit communication about a pending case's merits or posture. Route those questions through department staff.",
          ],
        },
        sources: [
          {
            label: "Zoning Board of Appeals",
            url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/zoning_board_of_appeals.html",
          },
          {
            label: "ZBA Rules of Procedure",
            url: "https://www.chicago.gov/content/dam/city/depts/dol/rulesandregs/ZBA-Rules-of-Procedure-2025.pdf",
          },
        ],
      },
      {
        id: "what-each-body-hands-you",
        code: "L1.3",
        moduleId: "decisions",
        title: "What each body hands you",
        minutes: 3,
        figureAfterParagraph: 4,
        body: [
          [
            "\"We're approved\" means at least four different things depending on who said it. So the fastest way to learn where a project actually stands is to stop asking whether it is approved and start asking what piece of paper exists, and who signed it. Trace the paper and the confusion drains out.",
          ],
          [
            { strong: "A zoning clearance" },
            " isn't a certificate you hold. It is a review that happens inside another application, so the only way you know it happened is that the application moves forward. Nothing gets handed to you — which is exactly why people conclude the step was skipped, and go looking for an office that could have skipped it.",
          ],
          [
            { strong: "A Zoning Board resolution" },
            " is a written decision, signed by the chair, including findings of fact that explain why an application was approved or denied. It resolves a zoning question, and because that is all it resolves, it does not authorize anyone to build anything.",
          ],
          [
            "From there the documents hand off in order. ",
            { strong: "A building permit" },
            " authorizes construction. ",
            { strong: "Inspection sign-offs" },
            " confirm that what was built matches what was permitted. ",
            { strong: "A Certificate of Occupancy" },
            ", where one is required, makes occupying the building lawful. ",
            { strong: "A business license" },
            " authorizes operating.",
          ],
          [
            "Six documents, four issuers, none interchangeable. And because each one authorizes only its own step, the most common and most expensive confusion is reading a zoning approval as permission to build, or a completed inspection as permission to open.",
          ],
        ],
        check: {
          prompt:
            "You hold a Zoning Board resolution approving a special use for your site. May construction begin?",
          options: [
            {
              key: "A",
              text: "Yes — the Board is the highest authority in the process",
            },
            {
              key: "B",
              text: "No — construction requires a building permit",
              correct: true,
            },
            {
              key: "C",
              text: "Only if the resolution includes findings of fact",
            },
          ],
          why: [
            { strong: "B." },
            " The resolution settles the zoning question. Construction is authorized by a building permit from the Department of Buildings, which is a separate application to a separate department.",
          ],
        },
        sources: [
          {
            label: "ZBA resolutions, 1982 to present",
            url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/zoning_board_of_appeals.html",
          },
          {
            label: "Department of Buildings — permits",
            url: "https://www.chicago.gov/city/en/depts/bldgs/provdrs/permits.html",
          },
        ],
      },
      {
        id: "why-a-stranger-knows",
        code: "L1.4",
        moduleId: "decisions",
        title: "Why a stranger knows about your permit",
        minutes: 2,
        body: [
          [
            "A week or two after you file, an email arrives. It demands payment of a permit fee to avoid a delay. It cites your address, describes your project, and quotes your application number correctly. It is not from the city.",
          ],
          [
            "The FBI has issued a public warning about criminals impersonating city and county officials to collect fraudulent payments for planning and zoning permits, and the reason those messages can be so exact is ordinary rather than sinister. The senders find their targets in ",
            { strong: "publicly available permit information" },
            " — the same records that make the development process transparent also make everyone with an open application findable, along with what they are building and what stage they are at.",
          ],
          [
            "That is the part worth sitting with, because it inverts the instinct. The details in the message are not evidence that the sender is legitimate; they are evidence that the sender can read a public database. Accuracy is the cheapest thing a scammer can obtain here, which is precisely why it feels so convincing.",
          ],
          [
            "Knowing that, the pattern is easy to spot. It has three parts: ",
            { strong: "specific knowledge" },
            " of your project, ",
            { strong: "urgency" },
            " — a deadline, a threatened delay, a lapsing approval — and a ",
            { strong: "payment method supplied in the message itself" },
            ". The third part is the tell, because any legitimate fee you owe will be payable through a channel you can find independently, on a department's own published page.",
          ],
          [
            "So the rule is short, and it follows straight from that. Never pay, click, or reply using contact information that arrived in the message. Look up the department yourself and ask them. A real obligation survives that phone call; a fake one doesn't.",
          ],
        ],
        check: {
          prompt:
            "An email cites your correct application number and demands immediate payment to prevent a delay. What does the correct application number tell you?",
          options: [
            {
              key: "A",
              text: "The sender has access to city systems, so it's likely genuine",
            },
            {
              key: "B",
              text: "Nothing about legitimacy — that information is public",
              correct: true,
            },
            {
              key: "C",
              text: "It's genuine only if the amount matches your fee estimate",
            },
          ],
          why: [
            { strong: "B." },
            " Permit application details are public record. Knowing them demonstrates only that the sender can read public data. Verify through the department's own published contact information, never the message's.",
          ],
        },
        sources: [
          {
            label: "FBI public service announcement on permit-payment impersonation",
            url: "https://www.ic3.gov/PSA/2026/PSA260309",
          },
          {
            label: "Report a scam to the FBI's Internet Crime Complaint Center",
            url: "https://www.ic3.gov",
          },
        ],
      },
    ],
  },
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "zoning",
    number: 2,
    navLabel: "02 Zoning",
    title: "Zoning and permitted uses",
    summary:
      "Read the published tables without turning public context into a City determination.",
    lessons: [
      {
        id: "read-the-table",
        code: "L2.1",
        moduleId: "zoning",
        title: "Read the table, not the rumor",
        minutes: 3,
        figureAfterParagraph: 4,
        body: [
          [
            "The listing says \"zoned for retail.\" The broker says the last tenant did something similar. The previous owner says it was never a problem. None of those is a source, and each one is confident enough to keep you from checking. Getting to a real answer takes three moves, and they only work in this order.",
          ],
          [
            { strong: "First, identify the parcel." },
            " A street address is a convenience, not an identifier — addresses get shared across buildings, split, renumbered, and misreported, so an answer pinned to an address can be an answer about the wrong land. The Property Index Number, the PIN, is how the county identifies a specific piece of land, which is what you want when you are about to spend money based on the answer.",
          ],
          [
            { strong: "Then find the district." },
            " Every parcel sits in a mapped zoning district, and the official zoning map is what says which one. Not the listing, not a screenshot, not a third-party site working from an old copy — those are all reports of the map rather than the map.",
          ],
          [
            { strong: "Last, translate your business into a use category." },
            " This is where most people go wrong, because the ordinance does not organize itself by what businesses call themselves. It organizes by ",
            { em: "use category" },
            " — its own classification for activities — so the name on your sign has no entry to look up.",
          ],
          [
            "One trap is worth naming, since it defeats all three moves at once: what the previous tenant did tells you very little. They may have been operating under a special use approval that doesn't travel with the space, or as a nonconforming use tied to circumstances that ended when they left. Inheriting a storefront is not inheriting its permissions.",
          ],
        ],
        check: {
          prompt:
            "Your business calls itself a \"juice bar.\" What do you look up in the ordinance?",
          options: [
            { key: "A", text: "\"Juice bar\" in the index" },
            {
              key: "B",
              text: "The use category the ordinance assigns to that activity",
              correct: true,
            },
            { key: "C", text: "Whatever the previous tenant was classified as" },
          ],
          why: [
            { strong: "B." },
            " The use tables are organized by use categories defined in the ordinance, not by trade names. What the previous tenant did may reflect approvals or conditions that do not transfer with the space.",
          ],
        },
        sources: [
          {
            label: "Zoning code text and official zoning map",
            url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/zoning_board_of_appeals.html",
          },
          {
            label: "Use groups and use categories, § 17-17-0100",
            url: "https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-48750",
          },
        ],
      },
      {
        id: "four-symbols",
        code: "L2.2",
        moduleId: "zoning",
        title: "Four symbols, four futures",
        minutes: 3,
        figureAfterParagraph: 1,
        body: [
          [
            "One character in one cell decides whether you open in two months or two years, so it is worth knowing how to find it. The zoning ordinance answers \"can I do this here?\" with a table. Down the side are ",
            { strong: "use categories" },
            " — the ordinance's own classifications for activities, which is why you look up what your business ",
            { em: "is" },
            ", not what it calls itself. Across the top are ",
            { strong: "zoning districts" },
            ". Find your row, find your column, and the cell where they cross holds one of four characters.",
          ],
          [
            { strong: "P — permitted by right." },
            " The use is allowed in that district. Note what this does not mean: it doesn't mean no approvals, because every other standard in the ordinance still applies. It means you don't need special use approval.",
          ],
          [
            { strong: "S — special use." },
            " Allowed, but only after review and approval under the special use procedures at § 17-13-0900. That routes you to the Zoning Board, which considers whether the use fits this particular location — so an S is not a no. It is a longer yes.",
          ],
          [
            { strong: "PD — planned development." },
            " Allowed only through the planned development process at § 17-13-0600. This one is commonly misread as a size threshold, something that kicks in only for large projects. It isn't. PD is its own designation in the table, so where the table says PD, it says PD no matter how small the project is.",
          ],
          [
            { strong: "– — prohibited." },
            " Expressly not allowed. A dash feels like the worst outcome and is frequently the most valuable one you can get, because a dash found in week one saves you the months that a dash found in month six costs.",
          ],
          [
            "Which is why the discipline here is so simple: the table is the authority. A listing description, a broker's summary, whatever the last tenant was doing — each of those is a guess about what the cell says. Go read the cell.",
          ],
        ],
        check: {
          prompt:
            "Your use shows \"PD\" in your district, and yours is a small project. What does that tell you?",
          options: [
            {
              key: "A",
              text: "PD applies only to large projects, so it doesn't affect you",
            },
            {
              key: "B",
              text: "The use requires planned development approval regardless of size",
              correct: true,
            },
            { key: "C", text: "You may choose between PD and special use" },
          ],
          why: [
            { strong: "B." },
            " PD is a use-table designation, not a size threshold. Where the table assigns PD to a use, that process applies at any scale.",
          ],
        },
        sources: [
          {
            label: "Chicago Zoning Ordinance — allowed uses by district",
            url: "https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-49164",
          },
          {
            label: "Official zoning map and code text",
            url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/zoning_board_of_appeals.html",
          },
        ],
      },
      {
        id: "three-asks-one-board",
        code: "L2.3",
        moduleId: "zoning",
        title: "Three different asks to one board",
        minutes: 3,
        figureAfterParagraph: 4,
        body: [
          [
            "People say \"I'm going to zoning\" as though it were one thing. It is three, they go to the same board, and walking in with the wrong one is a way to lose months — because each asks a different question and therefore needs a different case.",
          ],
          [
            { strong: "A special use" },
            " asks whether a use the ordinance already contemplates for your district belongs at this particular location. The table said S, so the use isn't forbidden. It is conditional, and the condition is compatibility with what's around it.",
          ],
          [
            { strong: "A variation" },
            " asks for relief from a standard. The rule exists, you can't meet it, and you're asking for it to apply differently here. Notice how the posture flips: a special use argues ",
            { em: "this fits" },
            ", while a variation argues ",
            { em: "this rule works badly on this parcel" },
            ".",
          ],
          [
            { strong: "An appeal" },
            " argues that the Zoning Administrator got it wrong. Here you are not asking for permission or relief at all — you are contesting a determination, and the question is what the ordinance actually says.",
          ],
          [
            "Sorting your situation into the right one of these three is most of the work, and it pays off immediately. It determines what you have to prove, which evidence is even relevant, and whether you are asking for a favor or asserting a right.",
          ],
        ],
        check: {
          prompt:
            "Staff tells you your use isn't allowed in your district. You believe they read the use table incorrectly. What is that?",
          options: [
            { key: "A", text: "A special use request" },
            { key: "B", text: "A variation request" },
            { key: "C", text: "An appeal", correct: true },
          ],
          why: [
            { strong: "C." },
            " You aren't seeking permission or relief — you're contesting a determination. Appeals of the Zoning Administrator's decisions are one of the Board's three jurisdictions.",
          ],
        },
        sources: [
          {
            label: "Zoning Board of Appeals — application materials",
            url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/zoning_board_of_appeals.html",
          },
          {
            label: "Variations, § 17-13-1100",
            url: "https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-51987",
          },
        ],
      },
      {
        id: "what-a-hearing-is",
        code: "L2.4",
        moduleId: "zoning",
        title: "What a hearing actually is",
        minutes: 3,
        figureAfterParagraph: 4,
        body: [
          [
            "Speakers are sworn in by the chair. Witnesses can be questioned by the other side. Board members ask whatever they want, whenever they want. The decision arrives as a signed written document containing findings of fact. That is a courtroom, not a meeting — and once you see it that way, every rule that seemed strange starts making sense.",
          ],
          [
            { strong: "Everyone who speaks is identified and sworn." },
            " The chair administers oaths and can compel witnesses to attend, so what you say is testimony rather than an opinion offered.",
          ],
          [
            { strong: "Both sides get to examine witnesses." },
            " A public hearing carries the right to appear and present evidence, and because evidence has to be testable to be worth anything, it carries the right to hear and question the witnesses the other side brings.",
          ],
          [
            { strong: "The decision is written and reasoned." },
            " The chair signs a written decision including findings of fact, and the Board keeps minutes recording how each member voted — a record that exists precisely because the decision has to be traceable to what was on it.",
          ],
          [
            "Now the trap, which costs people their participation more often than anything else in this lesson. ",
            { strong: "If you want to present evidence or cross-examine witnesses, you must register with the Board in advance." },
            " There is a deadline that runs before the hearing date. Miss it and you can still attend and watch, but you have given up standing to participate as a party.",
          ],
          [
            "That deadline is why neighbors sometimes arrive prepared and articulate on the day and still can't be heard the way they expected. Nobody is being unfair to them. They filed nothing, and this is a proceeding on a record.",
          ],
        ],
        check: {
          prompt:
            "You intend to cross-examine a witness at an upcoming hearing. What must have happened first?",
          options: [
            { key: "A", text: "Nothing — anyone attending may question witnesses" },
            {
              key: "B",
              text: "You must have registered with the Board in advance",
              correct: true,
            },
            { key: "C", text: "You must be represented by an attorney" },
          ],
          why: [
            { strong: "B." },
            " Participants who want to present evidence or cross-examine must register with the Board ahead of the hearing date. Check the current deadline in the Rules of Procedure — attending is open, participating as a party is not.",
          ],
        },
        sources: [
          {
            label:
              "ZBA Rules of Procedure — registration deadlines and hearing conduct",
            url: "https://www.chicago.gov/content/dam/city/depts/dol/rulesandregs/ZBA-Rules-of-Procedure-2025.pdf",
          },
          {
            label: "ZBA meetings, calendar, and minutes",
            url: "https://www.chicago.gov/city/en/depts/dcd/supp_info/zoning_board_of_appeals.html",
          },
        ],
      },
    ],
  },
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "permits",
    number: 3,
    navLabel: "03 Permits",
    title: "Permits and opening",
    summary:
      "Understand the approvals that authorize construction, occupancy, and operation.",
    lessons: [
      {
        id: "when-no-permit",
        code: "L3.1",
        moduleId: "permits",
        title: "The cheapest lesson: when you need no permit",
        minutes: 2,
        body: [
          [
            "The fastest permit is the one you don't need. A limited range of nonstructural repairs, minor alterations, some site work, and non-occupied structures require no building permit at all, so finding out whether your project sits in that range is the single cheapest five minutes available to you.",
          ],
          [
            "There is a principle underneath the list, and it is worth carrying even when the details change: ",
            { strong: "the line is drawn at structure and escape." },
          ],
          [
            "Work stays outside the permit requirement when it doesn't touch what holds the building up or how people get out of it. Interior finishes are the clearest case — carpet, hardwood, tile, paint, wallpaper — because you are changing surfaces, not the building.",
          ],
          [
            "Work crosses into requiring a permit once it cuts away or removes part of an exterior wall, an interior wall or partition, a subfloor, or a roof; removes or cuts a structural beam, column, or load-bearing support; or removes or changes a required means of egress.",
          ],
          [
            "Read that list again and notice it is really two ideas. The first several items are structure, the things that keep the building standing. The last is egress, the path people use to get out in an emergency. Those are the two things the building code exists to protect, which is exactly why they are the two things that trigger review.",
          ],
          [
            "One caution follows from who bears the risk. A contractor telling you \"you don't need a permit for that\" is not a source, and the consequences of being wrong land on the owner, not the contractor.",
          ],
        ],
        check: {
          prompt:
            "Which of these crosses the line into requiring a building permit?",
          options: [
            { key: "A", text: "New paint and carpet throughout the space" },
            {
              key: "B",
              text: "Removing an interior partition wall to open up the floor plan",
              correct: true,
            },
            { key: "C", text: "Replacing cabinets and countertops" },
          ],
          why: [
            { strong: "B." },
            " The boundary is structure and egress. Removing part of an interior wall or partition is exactly the kind of work that triggers a permit requirement; surface finishes generally do not.",
          ],
        },
        sources: [
          {
            label: "When is a building permit NOT required?",
            url: "https://www.chicago.gov/city/en/depts/bldgs/provdrs/permits/svcs/no-permit-reqd.html",
          },
          {
            label: "Guide to Building Permits — work types not requiring a permit",
            url: "https://www.chicago.gov/city/en/sites/guide-to-building-permits/home/help/faq/DOB/bldg-permit-not-required/all.html",
          },
        ],
      },
      {
        id: "four-permit-tracks",
        code: "L3.2",
        moduleId: "permits",
        title: "Four tracks, and what sorts you into one",
        minutes: 3,
        figureAfterParagraph: 1,
        body: [
          [
            "Most guides to Chicago permitting name three tracks, and one of the three they name was discontinued in November 2023. That is worth knowing for its own sake, and worth knowing as a warning: program names look like stable structure and aren't. Here are the four current application programs.",
          ],
          [
            "What sorts you into a track is the nature and complexity of the work, not your preference or your hurry. A project needing architectural plans is not going to fit through a repair-oriented track because you would like it to move faster.",
          ],
          [
            "So the useful habit isn't memorizing the four names. It is recognizing the shape underneath them: a light track for repairs, a professional-certification track, a full-review track, and a complex-project track. That shape has been stable across renamings. The names haven't.",
          ],
        ],
        check: {
          prompt:
            "Which program is the main process for a permit application that requires architectural plans?",
          options: [
            { key: "A", text: "Express Permit Program" },
            {
              key: "B",
              text: "Standard Plan Review Permit Program",
              correct: true,
            },
            { key: "C", text: "Developer Services Permit Program" },
          ],
          why: [
            { strong: "B." },
            " Standard Plan Review is the main track for applications requiring architectural plans. Express covers repairs and small improvements; Developer Services is aimed at moderate to complex projects.",
          ],
        },
        sources: [
          {
            label:
              "Department of Buildings — permits index and all current programs",
            url: "https://www.chicago.gov/city/en/depts/bldgs/provdrs/permits.html",
          },
        ],
      },
      {
        id: "self-certification",
        code: "L3.3",
        moduleId: "permits",
        title: "Self-certification is a liability transfer",
        minutes: 2,
        figureAfterParagraph: 2,
        body: [
          [
            "Self-certification is usually described as a way to skip plan review. That description is accurate about the mechanics and completely wrong about what is happening, because nobody waived anything. Someone signed for it.",
          ],
          [
            "Under the Self-Certified Permit Application Program, the ",
            { strong: "design professional of record" },
            " — an Illinois-licensed architect or structural engineer — takes full responsibility for code compliance. They stamp the drawings and certify that the plans comply with the Chicago building code, and it is on that basis, not on any relaxation of the rules, that the department forgoes conducting its own plan review.",
          ],
          [
            "So the code did not get easier and the review did not get skipped. What changed is ",
            { em: "who is answerable" },
            " if the plans turn out not to comply, and that shift is where the speed comes from.",
          ],
          [
            "Two consequences follow from that, and both surprise people. Not every project qualifies, because eligibility is defined by the program and wanting to move faster doesn't create it. And not every architect will do it, because a professional certifying compliance is accepting exposure they would otherwise share with a plan examiner. If a designer is reluctant, that is a considered professional judgment about risk, not obstruction.",
          ],
        ],
        check: {
          prompt: "Under self-certification, who is responsible for code compliance?",
          options: [
            {
              key: "A",
              text: "The Department of Buildings, which reviews after the fact",
            },
            { key: "B", text: "The design professional of record", correct: true },
            { key: "C", text: "The general contractor performing the work" },
          ],
          why: [
            { strong: "B." },
            " The design professional of record certifies that the stamped plans comply, and the department forgoes its own plan review on that basis. The requirement didn't change — the responsibility moved.",
          ],
        },
        sources: [
          {
            label: "Self-Certified Permit Application Program",
            url: "https://www.chicago.gov/city/en/depts/bldgs/provdrs/permits/svcs/self-cert-permits.html",
          },
        ],
      },
      {
        id: "three-finish-lines",
        code: "L3.4",
        moduleId: "permits",
        title: "Permit, occupancy, license: three finish lines",
        minutes: 3,
        figureAfterParagraph: 1,
        body: [
          [
            "Finishing construction is not the same as being allowed to occupy the space, and being allowed to occupy the space is not the same as being allowed to operate a business in it. Three finish lines, three issuers, and each one crossed on its own terms.",
          ],
          [
            "Here is the part almost every popular guide gets wrong: ",
            { strong: "not every project requires a Certificate of Occupancy." },
            " It is required for permitted work falling into specific categories — a building with enough dwelling or sleeping units, non-residential work above a floor-area threshold, a ",
            { strong: "change of occupancy" },
            ", or work on assembly, educational, institutional, or hazardous occupancies. Because the trigger is the category and not the finish of construction, \"get your Certificate of Occupancy and open your doors\" is simply not the story for many small tenant build-outs. Plenty never require one at all.",
          ],
          [
            "Getting this wrong hurts in both directions, which is why it is worth settling early. Assume you need one when you don't and you wait for a document nobody is going to issue. Assume you don't when you do and you have a real problem, because where a certificate is required, ",
            { strong: "it is unlawful to occupy the building, or let anyone else occupy it, before obtaining that certificate" },
            " — or a partial or temporary one.",
          ],
          [
            "Watch the change-of-occupancy trigger especially. Converting a space from one kind of use to another can put you in scope even when the space is small and the work looks modest, so the size of the job is a poor guide to which side of the line you are on.",
          ],
        ],
        check: {
          prompt: "Does every commercial build-out end with a Certificate of Occupancy?",
          options: [
            { key: "A", text: "Yes — it's the final step for all construction" },
            {
              key: "B",
              text: "No — it's required only for specific categories of work",
              correct: true,
            },
            { key: "C", text: "Only for new buildings, never for renovations" },
          ],
          why: [
            { strong: "B." },
            " The requirement is triggered by categories — unit counts, floor area, change of occupancy, and certain occupancy types — not by every project. Where it does apply, occupying before obtaining it is unlawful, so confirm which side of the line your project falls on.",
          ],
        },
        sources: [
          {
            label: "Certificates of Occupancy",
            url: "https://www.chicago.gov/city/en/depts/bldgs/supp_info/certificate-of-occupancy.html",
          },
          {
            label: "Permit-related building inspections",
            url: "https://www.chicago.gov/city/en/depts/bldgs/provdrs/inspect/svcs/permit_inspection.html",
          },
          {
            label: "Chicago Business Licensing — application requirements",
            url: "https://www.chicago.gov/city/en/sites/chicago-business-licensing/home/license-application-requirements.html",
          },
        ],
      },
    ],
  },
];

/** Every lesson, in reading order. */
export const LEARNING_LESSONS: readonly Lesson[] = LEARNING_MODULES.flatMap(
  (learningModule) => learningModule.lessons,
);

/** The denominator in "n of 12 checks complete". */
export const LEARNING_CHECK_TOTAL = LEARNING_LESSONS.length;

/**
 * The headline reading time, kept exactly as the artifact published it.
 * Per-lesson `minutes` values are the artifact's own and sum slightly
 * higher; the visitor-facing figure is not silently recomputed, because
 * changing a published number is not part of a prose rewrite.
 */
export const LEARNING_MINUTES_LABEL = "~30";

/** Flattens a paragraph to plain text — used for tests and aria copy. */
export function lessonParagraphText(paragraph: LessonParagraph): string {
  return paragraph
    .map((span) =>
      typeof span === "string"
        ? span
        : "strong" in span
          ? span.strong
          : span.em,
    )
    .join("");
}
