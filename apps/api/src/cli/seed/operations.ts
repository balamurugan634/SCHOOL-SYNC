import { v7 as uuidv7 } from 'uuid';
import { addDaysIso, todayIn } from '../../core/http';
import { libraryBooks, libraryIssues, studentTransport, transportRoutes, transportStops, transportVehicles } from '../../db/tenant/schema';
import type { ModuleSeeder } from './context';

/** Demo data for operations: 5 vehicles, 3 routes (~60 students on the bus), a 150-title library with ~40 loans (some overdue). */
export const seed: ModuleSeeder = async (ctx) => {
  const { db, tenant } = ctx;
  const today = todayIn(tenant.timezone);
  const chunks = async <T>(rows: T[], size: number, fn: (c: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
  };

  // ── transport ─────────────────────────────────────────────────────────────────────────────────
  const vehicles = await db
    .insert(transportVehicles)
    .values([
      { registrationNo: 'KA-01-AB-1201', model: 'Tata Starbus 40-seater', capacity: 40, driverName: 'Ramesh Gowda', driverPhone: '9845012345', attendantName: 'Lakshmi Devi', insuranceExpiry: addDaysIso(today, 240) },
      { registrationNo: 'KA-01-AB-2234', model: 'Eicher Skyline 45-seater', capacity: 45, driverName: 'Suresh Babu', driverPhone: '9845067890', attendantName: 'Kavitha R', insuranceExpiry: addDaysIso(today, 20) },
      { registrationNo: 'KA-05-MH-3380', model: 'Force Traveller', capacity: 26, driverName: 'Imran Pasha', driverPhone: '9886123456', attendantName: 'Mary Joseph', insuranceExpiry: addDaysIso(today, -12) },
      { registrationNo: 'KA-03-CD-4471', model: 'Ashok Leyland Lynx 52-seater', capacity: 52, driverName: 'Mahesh Kumar', driverPhone: '9741234567', attendantName: 'Rekha S', insuranceExpiry: addDaysIso(today, 310) },
      { registrationNo: 'KA-02-EF-5509', model: 'Tata Winger (spare)', capacity: 18, driverName: 'Nagaraj', driverPhone: '9900112233', insuranceExpiry: addDaysIso(today, 95) },
    ])
    .returning();
  const routeDefs: { name: string; vehicle: number; pickup: string; drop: string; stops: [string, number][] }[] = [
    { name: 'Route 1 – Whitefield & Lake View', vehicle: 0, pickup: '06:45', drop: '15:40', stops: [['ITPL Main Road', 0], ['Hope Farm Junction', 8], ['Varthur Kodi', 15], ['Lake View Apartments', 22], ['Kundalahalli Gate', 29], ['School Gate', 38]] },
    { name: 'Route 2 – Indiranagar & MG Road', vehicle: 1, pickup: '06:50', drop: '15:45', stops: [['MG Road Metro', 0], ['Trinity Circle', 6], ['Indiranagar 100ft Road', 13], ['Domlur Flyover', 20], ['HAL Old Airport Road', 27], ['Marathahalli Bridge', 33], ['School Gate', 42]] },
    { name: 'Route 3 – Jayanagar & BTM', vehicle: 3, pickup: '06:40', drop: '15:50', stops: [['Jayanagar 4th Block', 0], ['South End Circle', 7], ['BTM 2nd Stage', 15], ['Silk Board', 23], ['HSR Layout Sector 2', 31], ['School Gate', 40]] },
  ];
  const hm = (base: string, plus: number) => {
    const [h, m] = base.split(':').map(Number) as [number, number];
    const t = h * 60 + m + plus;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  const routes = await db
    .insert(transportRoutes)
    .values(routeDefs.map((r) => ({ name: r.name, vehicleId: vehicles[r.vehicle]!.id, pickupStartTime: r.pickup, dropStartTime: r.drop })))
    .returning();
  const stopRows = routeDefs.flatMap((r, ri) =>
    r.stops.map(([name, offset], i) => ({
      id: uuidv7(),
      routeId: routes[ri]!.id,
      name,
      ordinal: i + 1,
      pickupTime: hm(r.pickup, offset),
      // the afternoon run visits the stops in the same order, starting after school
      dropTime: hm(r.drop, offset),
      lat: 12.9 + ctx.rng() * 0.15,
      lng: 77.55 + ctx.rng() * 0.2,
      feeMinor: 120_000 + ctx.int(0, 6) * 10_000,
    })),
  );
  await db.insert(transportStops).values(stopRows);

  // about 60 students use the bus (about half of a small demo school); the demo student always does
  const target = Math.min(60, Math.max(3, Math.round(ctx.students.length * 0.5)));
  const pool = [...ctx.students];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const first = ctx.students[0]!;
  const riders = [first, ...pool.filter((s) => s.id !== first.id)].slice(0, target);
  const seats = vehicles.map((v) => v.capacity);
  const used = [0, 0, 0];
  const alloc = riders.map((s, i) => {
    let ri = i % 3;
    while (used[ri]! >= seats[routeDefs[ri]!.vehicle]!) ri = (ri + 1) % 3;
    used[ri]!++;
    const stops = stopRows.filter((x) => x.routeId === routes[ri]!.id).slice(0, -1); // not the school gate itself
    return { studentId: s.id, routeId: routes[ri]!.id, stopId: stops[Math.floor(ctx.rng() * stops.length)]!.id, startDate: `${ctx.yearName.slice(0, 4)}-06-10` };
  });
  await chunks(alloc, 500, (c) => db.insert(studentTransport).values(c));

  // ── library ───────────────────────────────────────────────────────────────────────────────────
  type B = [title: string, author: string, category: string];
  const classics: B[] = [
    ['The Jungle Book', 'Rudyard Kipling', 'Fiction'], ['Treasure Island', 'Robert Louis Stevenson', 'Fiction'], ['Alice’s Adventures in Wonderland', 'Lewis Carroll', 'Fiction'], ['The Adventures of Tom Sawyer', 'Mark Twain', 'Fiction'],
    ['Swami and Friends', 'R. K. Narayan', 'Fiction'], ['Malgudi Days', 'R. K. Narayan', 'Fiction'], ['Gulliver’s Travels', 'Jonathan Swift', 'Fiction'], ['Black Beauty', 'Anna Sewell', 'Fiction'],
    ['Heidi', 'Johanna Spyri', 'Fiction'], ['Little Women', 'Louisa May Alcott', 'Fiction'], ['The Wind in the Willows', 'Kenneth Grahame', 'Fiction'], ['Charlie and the Chocolate Factory', 'Roald Dahl', 'Fiction'],
    ['Matilda', 'Roald Dahl', 'Fiction'], ['The BFG', 'Roald Dahl', 'Fiction'], ['Harry Potter and the Philosopher’s Stone', 'J. K. Rowling', 'Fiction'], ['The Hobbit', 'J. R. R. Tolkien', 'Fiction'],
    ['The Lion, the Witch and the Wardrobe', 'C. S. Lewis', 'Fiction'], ['Wonder', 'R. J. Palacio', 'Fiction'], ['The Diary of a Young Girl', 'Anne Frank', 'Biography'], ['Wings of Fire', 'A. P. J. Abdul Kalam', 'Biography'],
    ['My Experiments with Truth', 'M. K. Gandhi', 'Biography'], ['Long Walk to Freedom (abridged)', 'Nelson Mandela', 'Biography'], ['The Story of My Life', 'Helen Keller', 'Biography'], ['I Am Malala', 'Malala Yousafzai', 'Biography'],
    ['Ignited Minds', 'A. P. J. Abdul Kalam', 'Biography'], ['Discovery of India (for young readers)', 'Jawaharlal Nehru', 'History'], ['A Brief History of Time (young readers)', 'Stephen Hawking', 'Science'], ['Cosmos', 'Carl Sagan', 'Science'],
    ['The Magic School Bus: Inside the Earth', 'Joanna Cole', 'Science'], ['Our Wonderful World of Insects', 'Rohini Chowdhury', 'Science'], ['Why? Questions and Answers about Science', 'Usborne', 'Science'], ['The Story of Inventions', 'Anita Ganeri', 'Science'],
    ['Famous Scientists of India', 'S. Chandrasekhar', 'Science'], ['The Book of Dinosaurs', 'DK', 'Science'], ['Oceans: A Visual Encyclopedia', 'DK', 'Science'], ['Human Body Atlas', 'DK', 'Science'],
    ['Mathematics Is Fun', 'Y. Perelman', 'Mathematics'], ['The Number Devil', 'Hans Magnus Enzensberger', 'Mathematics'], ['Vedic Mathematics for Schools', 'Bharati Krishna Tirtha', 'Mathematics'], ['Puzzles to Puzzle You', 'Shakuntala Devi', 'Mathematics'],
    ['More Puzzles to Puzzle You', 'Shakuntala Devi', 'Mathematics'], ['Figuring: The Joy of Numbers', 'Shakuntala Devi', 'Mathematics'], ['Geometry Around Us', 'NCERT', 'Mathematics'], ['Fun with Numbers', 'Usborne', 'Mathematics'],
    ['Ancient India', 'R. C. Majumdar', 'History'], ['The Story of the Indian Constitution', 'Ministry of Education', 'History'], ['Our Pasts', 'NCERT', 'History'], ['Stories of the Freedom Struggle', 'Amar Chitra Katha', 'History'],
    ['The World War II Illustrated', 'DK', 'History'], ['Ancient Egypt', 'Usborne', 'History'], ['Mughal India', 'Rana Safvi', 'History'], ['Indian Mythology for Children', 'Devdutt Pattanaik', 'Mythology'],
    ['The Ramayana (retold)', 'R. K. Narayan', 'Mythology'], ['The Mahabharata (retold)', 'R. K. Narayan', 'Mythology'], ['Tales from the Panchatantra', 'Vishnu Sharma', 'Mythology'], ['Jataka Tales', 'Ananda Coomaraswamy', 'Mythology'],
    ['Tenali Rama Stories', 'Amar Chitra Katha', 'Comics'], ['Tinkle Digest Collection', 'Anant Pai', 'Comics'], ['Asterix the Gaul', 'René Goscinny', 'Comics'], ['The Adventures of Tintin: Destination Moon', 'Hergé', 'Comics'],
    ['Calvin and Hobbes Collection', 'Bill Watterson', 'Comics'], ['Amar Chitra Katha: Hanuman', 'Anant Pai', 'Comics'], ['Gidh', 'Premchand', 'Hindi Literature'], ['Godaan (abridged)', 'Premchand', 'Hindi Literature'],
    ['Panchtantra ki Kahaniyan', 'Vishnu Sharma', 'Hindi Literature'], ['Rashmirathi', 'Ramdhari Singh Dinkar', 'Hindi Literature'], ['Madhushala', 'Harivansh Rai Bachchan', 'Hindi Literature'], ['Nirmala', 'Premchand', 'Hindi Literature'],
    ['Chandrakanta (bal sanskaran)', 'Devaki Nandan Khatri', 'Hindi Literature'], ['Mahadevi Verma ki Kahaniyan', 'Mahadevi Verma', 'Hindi Literature'], ['Python for Kids', 'Jason R. Briggs', 'Technology'], ['Scratch Programming Playground', 'Al Sweigart', 'Technology'],
    ['Computer Science Class 9', 'NCERT', 'Technology'], ['How Computers Work', 'Ron White', 'Technology'], ['Robotics for Beginners', 'Usborne', 'Technology'], ['The Internet Safety Handbook', 'CBSE', 'Technology'],
    ['Drawing Made Easy', 'Ed Emberley', 'Arts'], ['The Art Book for Children', 'Phaidon', 'Arts'], ['Origami for Everyone', 'Usborne', 'Arts'], ['Basics of Indian Classical Music', 'Pandit Ravi Shankar', 'Arts'],
    ['Rhythms of India: Folk Dances', 'Sangeet Natak Akademi', 'Arts'], ['Oxford Advanced Learner’s Dictionary', 'Oxford', 'Reference'], ['Oxford Student Atlas for India', 'Oxford', 'Reference'], ['Concise Hindi–English Dictionary', 'Oxford', 'Reference'],
    ['Children’s Encyclopedia', 'DK', 'Reference'], ['Word Power Made Easy', 'Norman Lewis', 'Reference'], ['Wren & Martin High School English Grammar', 'Wren & Martin', 'Reference'], ['General Knowledge Digest', 'Manorama', 'Reference'],
  ];
  const curriculum: B[] = [];
  for (const g of [6, 7, 8, 9, 10]) {
    for (const [subject, publisher] of [['Science', 'NCERT'], ['Mathematics', 'NCERT'], ['Social Science', 'NCERT'], ['English – Honeycomb', 'NCERT'], ['Hindi – Vasant', 'NCERT']] as const) curriculum.push([`${subject}, Class ${g}`, publisher, 'Textbooks']);
  }
  const titles = [...classics, ...curriculum].slice(0, 150);
  while (titles.length < 150) titles.push([`Reference Volume ${titles.length + 1}`, 'School Library', 'Reference']);
  const copies = titles.map((t) => (t[2] === 'Textbooks' ? ctx.int(4, 6) : ctx.int(1, 4)));

  // loans first (so the stock can be computed exactly), then the books
  type Loan = { bookIdx: number; student?: (typeof ctx.students)[number]; staffId?: string; issued: number; returned: number | null; reminded?: number };
  const open = new Array<number>(titles.length).fill(0);
  const pair = new Set<string>();
  const perStudent = new Map<string, number>();
  const loans: Loan[] = [];
  const tryLoan = (l: Loan): boolean => {
    const who = l.student?.id ?? l.staffId!;
    const key = `${l.bookIdx}:${who}`;
    const isOpen = l.returned === null;
    if (isOpen && (open[l.bookIdx]! >= copies[l.bookIdx]! || pair.has(key) || (l.student && (perStudent.get(who) ?? 0) >= 3))) return false;
    if (isOpen) {
      open[l.bookIdx]!++;
      pair.add(key);
      if (l.student) perStudent.set(who, (perStudent.get(who) ?? 0) + 1);
    }
    loans.push(l);
    return true;
  };
  const sIdx = ctx.students.length;
  // the demo student: one book out and one overdue
  tryLoan({ bookIdx: 0, student: ctx.students[0]!, issued: 6, returned: null });
  tryLoan({ bookIdx: 18, student: ctx.students[0]!, issued: 24, returned: null, reminded: 3 });
  // ~7 more overdue (student and staff), ~16 current, ~13 returned (some late, with fines)
  let guard = 0;
  while (loans.length < 40 && guard++ < 2000) {
    const n = loans.length;
    const staffLoan = n % 9 === 8;
    const student = staffLoan ? undefined : ctx.students[1 + Math.floor(ctx.rng() * (sIdx - 1))] ?? ctx.students[0]!;
    const staffId = staffLoan ? ctx.teachers[Math.floor(ctx.rng() * ctx.teachers.length)]!.id : undefined;
    const loanDays = staffLoan ? 30 : 14;
    const kind = n < 9 ? 'overdue' : n < 25 ? 'current' : 'returned';
    const issued = kind === 'overdue' ? loanDays + 2 + ctx.int(0, 14) : kind === 'current' ? ctx.int(0, loanDays - 2) : 20 + ctx.int(0, 30);
    const daysHeld = ctx.int(3, loanDays + 10); // longer than the loan period = returned late (with a fine)
    const returned = kind === 'returned' ? Math.max(1, issued - daysHeld) : null;
    tryLoan({ bookIdx: Math.floor(ctx.rng() * titles.length), student, staffId, issued, returned, reminded: kind === 'overdue' && ctx.rng() < 0.4 ? 2 : undefined });
  }

  const bookRows = titles.map((t, i) => ({
    id: uuidv7(),
    accessionNo: `LB-${String(i + 1).padStart(4, '0')}`,
    isbn: `978-81-${String(10000 + i * 37).slice(0, 5)}-${String(100 + ((i * 13) % 900)).padStart(3, '0')}-${i % 10}`,
    title: t[0],
    author: t[1],
    publisher: t[1] === 'NCERT' ? 'NCERT' : (['Penguin', 'HarperCollins', 'Scholastic', 'Oxford', 'Rupa', 'Puffin'][i % 6] ?? null),
    category: t[2],
    shelf: `${t[2]!.charAt(0)}-${1 + (i % 14)}`,
    totalCopies: copies[i]!,
    availableCopies: copies[i]! - open[i]!,
  }));
  await chunks(bookRows, 150, (c) => db.insert(libraryBooks).values(c));
  const finePerDay = 100; // library policy default (₹1 per day)
  const issueRows = loans.map((l) => {
    const loanDays = l.student ? 14 : 30;
    const issuedOn = addDaysIso(today, -l.issued);
    const dueOn = addDaysIso(issuedOn, loanDays);
    const returnedOn = l.returned === null ? null : addDaysIso(today, -l.returned);
    const late = returnedOn && returnedOn > dueOn ? Math.round((Date.parse(returnedOn) - Date.parse(dueOn)) / 86_400_000) : 0;
    return {
      bookId: bookRows[l.bookIdx]!.id,
      studentId: l.student?.id ?? null,
      staffId: l.staffId ?? null,
      issuedOn,
      dueOn,
      returnedOn,
      fineMinor: late * finePerDay,
      issuedBy: ctx.staff.librarian?.userId ?? null,
      lastRemindedOn: l.reminded !== undefined && returnedOn === null && dueOn < today ? addDaysIso(today, -l.reminded) : null,
    };
  });
  await chunks(issueRows, 500, (c) => db.insert(libraryIssues).values(c));
};
