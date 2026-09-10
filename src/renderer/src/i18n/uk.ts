/**
 * Ukrainian translations.
 *
 * Keys are the English source strings, so anything missing here simply falls
 * back to English instead of showing an identifier.
 */
export const uk: Record<string, string> = {
  // Bottom panel
  Terminal: 'Термінал',
  Preview: 'Прев’ю',
  Debug: 'Налагодження',
  'Hide panel (⌃`)': 'Сховати панель (⌃`)',

  // Pull requests
  '{count} pull requests in this session': '{count} пул-реквестів у цій сесії',
  '{count} pull requests': '{count} пул-реквестів',

  // Navigation
  'Back (⌃-)': 'Назад (⌃-)',
  'Forward (⌃⇧-)': 'Вперед (⌃⇧-)',
  'Go to symbol (⌘⇧O)': 'Перейти до символу (⌘⇧O)',
  'Go to symbol…': 'Перейти до символу…',
  'Open a file first': 'Спершу відкрийте файл',
  'No symbols found in this file.': 'У цьому файлі не знайдено символів.',

  // Tabs
  'New conversation tab': 'Новий діалог у вкладці',
  'New tab': 'Ще діалог',
  'Close tab': 'Закрити вкладку',
  'Open to the side': 'Відкрити збоку',
  'Unsaved changes': 'Незбережені зміни',
  Close: 'Закрити',
  'Close all': 'Закрити всі',
  all: 'всі',

  // Blame
  'Blame unavailable — file is outside git or not committed yet.':
    'Blame недоступний — файл поза git або ще не закомічений.',
  'Reading blame…': 'Читаю blame…',

  // Editors
  'Could not open': 'Не вдалося відкрити',
  'Open in {editor}': 'Відкрити в {editor}',
  'Choose editor': 'Вибрати редактор',

  // Permissions
  'Allow this tool?': 'Дозволити інструмент?',
  Tool: 'Інструмент',
  Deny: 'Відхилити',
  Allow: 'Дозволити',

  // Messages
  'Remove bookmark': 'Прибрати закладку',
  Bookmark: 'Закладка',
  'Copy text back into the composer for editing':
    'Скопіювати текст у поле вводу для правки',
  Edit: 'Редагувати',
  'API error': 'Помилка API',
  Thinking: 'Роздуми',

  // Code search
  'Search project code…': 'Пошук по коду проєкту…',
  'Select a session first': 'Спершу виберіть сесію',
  'Match case': 'Враховувати регістр',
  '{hits} matches in {files} files': '{hits} збігів у {files} файлах',
  'Nothing found.': 'Нічого не знайдено.',
  '…{count} more': '…ще {count}',

  // Problems
  'Select a session to check the project.': 'Виберіть сесію, щоб перевірити проєкт.',
  Stop: 'Зупинити',
  Check: 'Перевірити',
  Clean: 'Чисто',
  'Press ▷ to check the project.': 'Натисніть ▷, щоб перевірити проєкт.',

  // Activity bar
  Sessions: 'Сесії',
  Files: 'Файли',
  Tasks: 'Задачі',
  Problems: 'Проблеми',
  '{tab} — hide': '{tab} — сховати',
  'Terminal (⌃`)': 'Термінал (⌃`)',

  // File tree
  'Select a session — its working directory becomes the project root.':
    'Виберіть сесію — її робоча директорія стане коренем проєкту.',
  'New file or folder': 'Створити файл або теку',
  Reload: 'Перечитати',
  'Reading…': 'Читаю…',
  Empty: 'Порожньо',

  // Preview
  'Failed to load': 'Не вдалося завантажити',
  Back: 'Назад',
  Forward: 'Вперед',
  'Open in browser': 'Відкрити у браузері',

  // Right panel
  Chat: 'Чат',
  Metrics: 'Метрики',

  // Skills
  Skills: 'Скіли',
  'Search skills…': 'Пошук скіла…',
  'Loading list…': 'Читаю список…',
  'The skill list is not known yet — it appears in the transcript after the first exchange.':
    'Список скілів ще не відомий — він з’являється в транскрипті після першого обміну повідомленнями.',

  // Notes
  Notes: 'Нотатки',
  'Export session to Markdown': 'Експортувати сесію у Markdown',
  'What this session is about, what is left to do…':
    'Про що ця сесія, що лишилось зробити…',
  Saved: 'Збережено',

  // Session list
  'Active: {status}': 'Активна: {status}',
  '{count} msg': '{count} повід.',
  'Remote Control was enabled for this session':
    'Для цієї сесії вмикали Remote Control',
  '{count} subagents': '{count} субагент(ів)',
  'New session': 'Нова сесія',
  'Filter by title…': 'Фільтр за назвою…',
  'Search across all session content (⌘F)': 'Пошук по вмісту всіх сесій (⌘F)',
  'Reading history…': 'Читаю історію…',
  'No sessions found': 'Сесій не знайдено',
  'Nothing found': 'Нічого не знайдено',

  // New session dialog
  'Filter by name or path…': 'Фільтр за назвою або шляхом…',
  'Nothing found. Pick a folder manually below.':
    'Нічого не знайдено. Виберіть теку вручну нижче.',
  'folder is gone': 'теки немає',
  '{count} sessions': '{count} сесій',
  'Choose another folder…': 'Вибрати іншу теку…',
  Model: 'Модель',
  default: 'за замовчуванням',
  permissions: 'дозволи',

  // History search
  'Search all history…': 'Пошук по всій історії…',
  'Search inside tool arguments and results':
    'Шукати в аргументах і результатах інструментів',
  '{hits} matches in {sessions} sessions': '{hits} збігів у {sessions} сесіях',
  you: 'ти',
  claude: 'клод',
  '…{count} more in this session': '…ще {count} у цій сесії',

  // Environment
  'Model environment': 'Оточення моделі',
  'MCP servers': 'MCP-сервери',
  'Check connection': 'Перевірити підключення',
  'Checking…': 'Перевіряю…',
  'Press refresh — the check takes a few seconds.':
    'Натисніть оновити — перевірка займає кілька секунд.',
  Agents: 'Агенти',
  Hooks: 'Хуки',
  'Not configured.': 'Не налаштовано.',
  Plugins: 'Плагіни',

  // Tool calls
  'running…': 'виконується…',
  Arguments: 'Аргументи',
  'Loading branch…': 'Читаю гілку…',
  'Hide subagent branch': 'Сховати гілку субагента',
  'Show subagent branch': 'Показати гілку субагента',
  'Branch is empty.': 'Гілка порожня.',
  task: 'завдання',
  subagent: 'субагент',
  Result: 'Результат',
  error: 'помилка',
  '(empty)': '(порожньо)',

  // Checkpoints
  'Restore files to this point': 'Повернути файли до цієї точки',
  'State before message': 'Стан перед реплікою',
  'created later': 'створений пізніше',
  'Working files will be overwritten. This can be undone right after the restore.':
    'Робочі файли буде перезаписано. Скасувати можна одразу після відкату.',
  Restored: 'Повернуто',
  Cancel: 'Скасувати',
  'Undo restore': 'Скасувати відкат',
  Restore: 'Повернути',
  'Restore points': 'Точки відкату',
  'no label': 'без підпису',
  '{count} files': '{count} ф',

  // Tool preview
  Command: 'Команда',
  'new file': 'новий файл',
  'Reading current content…': 'Читаю поточний вміст…',

  // Terminal
  'Terminals unavailable: the native module failed to load.':
    'Термінали недоступні: нативний модуль не завантажився.',
  Try: 'Спробуйте',
  'New terminal': 'Новий термінал',
  'Open terminal': 'Відкрити термінал',

  // Tasks
  'Select a session to see the project scripts.':
    'Виберіть сесію, щоб побачити скрипти проєкту.',
  Scripts: 'Скрипти',
  'No package.json with scripts in this project.':
    'У проєкті немає package.json зі скриптами.',
  'No runs yet.': 'Запусків ще не було.',
  Remove: 'Прибрати',
  'No output yet…': 'Виводу поки немає…',

  // Command palette
  'Command…': 'Команда…',
  'Recent files…': 'Нещодавні файли…',
  'Project file… (> for commands)': 'Файл проєкту… (> для команд)',

  // Activity
  requests: 'запитів',
  '{days} days ago': '{days} днів тому',
  today: 'сьогодні',
  Activity: 'Активність',
  'Counting…': 'Рахую…',
  Tools: 'Інструменти',
  calls: 'викликів',
  failed: 'з помилкою',
  Projects: 'Проєкти',
  'Share of input context read from cache instead of being written again':
    'Частка вхідного контексту, прочитаного з кешу замість повторного запису',
  'cache covers {percent}% of context': 'кеш покриває {percent}% контексту',

  // Changed files
  'File restored to its pre-session state': 'Файл повернуто до стану перед сесією',
  'Restore failed': 'Не вдалося відкотити',
  'Restore undone': 'Відкат скасовано',
  'Undo failed': 'Не вдалося скасувати',
  'before the session': 'стан перед сесією',
  'on disk now': 'зараз на диску',
  'Reading backup…': 'Читаю бекап…',
  'This session created the file — there is no earlier state to restore.':
    'Файл створила ця сесія — попереднього стану не існує, відкотити нема до чого.',
  'File is not on disk': 'Файлу немає на диску',
  'Restore to pre-session state': 'Повернути до стану перед сесією',
  'Changed files': 'Змінені файли',
  gone: 'немає',

  // File context menu
  Failed: 'Не вдалося',
  'Move “{name}” to Trash?': 'Перемістити «{name}» у Кошик?',
  'New file': 'Новий файл',
  'New folder': 'Нова тека',
  Rename: 'Перейменувати',
  'Copy path': 'Копіювати шлях',
  'Reveal in file manager': 'Показати у файловому менеджері',
  'Move to Trash': 'У Кошик',
  'New name': 'Нова назва',
  Name: 'Назва',

  // Inline chat
  'Could not get a response': 'Не вдалося отримати відповідь',
  '{count} lines': '{count} рядк.',
  'What should happen to this fragment? For example: add error handling':
    'Що зробити з фрагментом? Наприклад: додай обробку помилок',
  Explain: 'Пояснити',
  'Rewrite (↵)': 'Переписати (↵)',
  'Thinking…': 'Думаю…',
  'Changes not applied yet': 'Зміни ще не застосовані',
  Again: 'Ще раз',
  Apply: 'Застосувати',

  // Rename symbol
  'The language server proposed no changes — the symbol may not be renameable':
    'Мовний сервер не запропонував змін — символ може бути не перейменовуваним',
  '{edits} replacements in {files} files': '{edits} замін у {files} файлах',
  lines: 'рядки',
  Renamed: 'Перейменовано',
  'Review the list before applying': 'Перевірте перелік перед застосуванням',
  'Edits come from the language server': 'Правки готує мовний сервер',
  'Preview changes': 'Переглянути зміни',

  // Replace
  'Replace in project': 'Заміна по проєкту',
  'Find…': 'Що замінити…',
  'Regular expression': 'Регулярний вираз',
  'Replace with… ($1 for groups)': 'Чим замінити… ($1 для груп)',
  'Replace with…': 'Чим замінити…',
  '{total} occurrences in {files} files': '{total} входжень у {files} файлах',
  '{count} selected': 'вибрано {count}',
  'Replaced {count} in {files} files': 'Замінено {count} у {files} файлах',
  '{count} failed': '{count} не вдалося',
  'A replace cannot be undone in one move — check the list above.':
    'Заміну не можна скасувати одним рухом — перевірте перелік вище.',
  Replace: 'Замінити',

  // Branch diff
  'Pick two different branches.': 'Виберіть різні гілки.',
  'The branches are identical.': 'Гілки не відрізняються.',
  'Select a file to see the changes.': 'Виберіть файл, щоб побачити зміни.',

  // Compare sessions
  '{count} messages': '{count} повідомлень',
  'This branch went no further than the common point.':
    'Ця гілка не пішла далі спільної точки.',
  '(no text)': '(без тексту)',
  'Compare branches': 'Порівняти гілки',
  'Pick a second session…': 'Виберіть другу сесію…',
  'Shared messages': 'Спільних повідомлень',
  'diverged after': 'розійшлися після',
  'one branch is a full prefix of the other': 'одна гілка є повним початком іншої',
  'No shared prefix — these are independent sessions, not branches.':
    'Спільного початку немає — це незалежні сесії, а не гілки.',
  'this session': 'ця сесія',
  'second session': 'друга сесія',
  'No other sessions in this project to compare with.':
    'У цьому проєкті немає інших сесій для порівняння.',
  'Pick a second session.': 'Виберіть другу сесію.',

  // Conflicts
  'Could not save': 'Не вдалося зберегти',
  'Could not mark as resolved': 'Не вдалося позначити вирішеним',
  '{count} conflicts': '{count} конфліктів',
  'Reading file…': 'Читаю файл…',
  'No conflicts left.': 'Конфліктів більше немає.',
  'Mark the file resolved to stage it.':
    'Позначте файл вирішеним, щоб додати його в індекс.',
  Lines: 'Рядки',
  'Take ours': 'Взяти наше',
  'Take theirs': 'Взяти їхнє',
  Both: 'Обидва',
  'Trickier spots can be finished by hand in the editor.':
    'Складні місця можна дорішати вручну в редакторі.',
  'Resolve every conflict first': 'Спершу вирішіть усі конфлікти',
  Resolved: 'Вирішено',

  // Settings
  Settings: 'Налаштування',
  'could not apply to the active conversation: {error}':
    'не вдалося застосувати до активного діалогу: {error}',
  unknown: 'невідомо',
  'restart the conversation to go back to the default model':
    'щоб повернути типову модель, перезапустіть діалог',
  'could not apply: {error}': 'не вдалося застосувати: {error}',
  'in conversation': 'у діалозі',
  Permissions: 'Дозволи',
  'Claude will run any tool without asking.':
    'Клод виконуватиме будь-які інструменти без підтвердження.',
  'Reasoning effort': 'Глибина міркувань',
  Default: 'За замовчуванням',
  'Format on save': 'Форматувати при збереженні',
  'Uses prettier, ruff or dart format from the project itself.':
    'Використовується prettier, ruff або dart format із самого проєкту.',
  'Model and reasoning effort apply to the next conversation — they are process arguments and are already fixed. Permission mode switches immediately.':
    'Модель і глибина міркувань застосуються до наступного діалогу — це аргументи процесу, і вони вже зафіксовані. Режим дозволів перемикається одразу.',

  // Debugger
  'Run {file}': 'Запустити {file}',
  'Open a .js file': 'Відкрийте файл .js',
  Continue: 'Продовжити',
  'Step over': 'Наступний рядок',
  'Step into': 'Увійти у виклик',
  'Step out': 'Вийти з виклику',
  paused: 'зупинено',
  running: 'виконується',
  '{count} breakpoints': '{count} точок зупину',
  'Call stack': 'Стек',
  'not started': 'не запущено',
  Breakpoints: 'Точки зупину',
  Variables: 'Змінні',
  'Evaluate expression…': 'Обчислити вираз…',
  Output: 'Вивід',
  'Run a file to see its output.': 'Запустіть файл, щоб побачити вивід.',

  // Pull requests panel
  'Could not create the PR': 'Не вдалося створити PR',
  'PR title…': 'Заголовок PR…',
  'Draft a title from the staged changes': 'Скласти заголовок із підготовлених змін',
  'Description (optional)': 'Опис (необовʼязково)',
  Draft: 'Чернетка',
  Create: 'Створити',
  'Pull requests': 'Пул-реквести',
  'Create a PR from the current branch': 'Створити PR із поточної гілки',
  'not found. Install the GitHub CLI to work with PRs without leaving the app.':
    'не знайдено. Встановіть GitHub CLI, щоб працювати з PR не виходячи із застосунку.',
  'Authentication required': 'Потрібна авторизація',
  'PR created': 'PR створено',
  'Current branch': 'Поточна гілка',
  'No open PRs.': 'Відкритих PR немає.',
  draft: 'чернетка',

  // File viewer
  truncated: 'обрізано',
  'Act on selection (⌘I)': 'Дії з виділеним (⌘I)',
  'Add to chat': 'Додати в чат',
  'Show line authors': 'Показати авторів рядків',
  'Save (⌘S)': 'Зберегти (⌘S)',
  'Close column': 'Закрити колонку',
  'Close file': 'Закрити файл',
  'File is too large — showing the first 2 MB. Editing is disabled so the rest is not lost.':
    'Файл завеликий — показано перші 2 МБ. Редагування вимкнено, щоб не втратити решту.',
  'Pick a file from the tree on the left.': 'Виберіть файл у дереві зліва.',

  // Git
  'Resolve conflict': 'Вирішити конфлікт',
  Unstage: 'Прибрати з індексу',
  Stage: 'Додати в індекс',
  'Discard changes in {path}? This cannot be undone.':
    'Скинути зміни у {path}? Це незворотно.',
  'Discard changes': 'Скинути зміни',
  'Select a session to see its repository.':
    'Виберіть сесію, щоб побачити її репозиторій.',
  'This is not a git repository.': 'Це не git-репозиторій.',
  'Could not draft a message': 'Не вдалося скласти повідомлення',
  'Could not review the changes': 'Не вдалося переглянути зміни',
  '{operation} failed': 'Не вдалося виконати {operation}',
  'Fetch from remote': 'Отримати зміни з віддаленого',
  'Pull and merge': 'Забрати й влити зміни',
  Push: 'Надіслати зміни',
  'Push and set upstream': 'Надіслати й привʼязати гілку',
  Stashes: 'Відкладені зміни',
  'Commit history': 'Історія комітів',
  Refresh: 'Оновити',
  'Show commit changes': 'Показати зміни коміту',
  'No commits yet': 'Комітів ще немає',
  Stashed: 'Відкладене',
  'stash current': 'відкласти поточні',
  restore: 'повернути',
  'Working tree is clean': 'Робоче дерево чисте',
  Staged: 'В індексі',
  Changes: 'Зміни',
  'stage all': 'додати всі',
  'Draft a commit message from the staged changes':
    'Скласти повідомлення коміту з підготовлених змін',
  Message: 'Повідомлення',
  'Review the staged changes before committing':
    'Переглянути підготовлені зміни перед комітом',
  Review: 'Рев’ю',
  'Commit message… (⌘↵)': 'Повідомлення коміту… (⌘↵)',
  'Stage some files first': 'Спершу додайте файли в індекс',
  Commit: 'Закомітити',

  // Metrics
  'resets in {time}': 'скидання через {time}',
  'resets {when}': 'скидання {when}',
  Input: 'Вхідні',
  'Cache written': 'Кеш записано',
  'Cache read': 'Кеш прочитано',
  'API requests': 'Запитів до API',
  'Plan limits': 'Ліміти плану',
  'Ask the CLI again (free)': 'Перепитати CLI (безкоштовно)',
  '7 days': '7 днів',
  '5 hours': '5 годин',
  'Last 24h': 'За добу',
  sessions: 'сесій',
  'From the history file': 'З файлу історії',
  stale: 'застаріле',
  'Asking the CLI…': 'Питаю CLI…',
  'Could not read the limits. Try refreshing.':
    'Не вдалося отримати ліміти. Спробуйте оновити.',
  'Context window': 'Контекстне вікно',
  '{used} of {total} tokens': '{used} з {total} токенів',
  'Current session': 'Поточна сесія',
  Total: 'Усього',
  Environment: 'Оточення',
  'Default model': 'Модель за замовч.',

  // Composer
  'Resume this session': 'Продовжити цю сесію',
  'Start a conversation': 'Почати діалог',
  'Continue as a separate branch — the original session stays untouched':
    'Продовжити окремою гілкою — оригінальна сесія лишиться незмінною',
  Fork: 'Відгалузити',
  'This tab is busy with another conversation — the session will open in a new tab.':
    'Поточна вкладка веде іншу розмову — ця сесія відкриється в новій вкладці.',
  'Select a session to set the working directory.':
    'Виберіть сесію, щоб задати робочу директорію.',
  'Remove from queue': 'Прибрати з черги',
  'Attach files': 'Прикріпити файли',
  'Drop files here': 'Відпустіть файли тут',
  'Claude is working — the message will be queued':
    'Клод працює — повідомлення стане в чергу',
  'Write a message… @ mentions a file, ↑ browses history':
    'Напишіть повідомлення… @ згадує файл, ↑ гортає історію',
  'Stop the turn and return the text to the field':
    'Зупинити хід і повернути текст у поле',
  'Queue (Enter)': 'Поставити в чергу (Enter)',
  'Send (Enter)': 'Надіслати (Enter)',
  'default model': 'модель за замовчуванням',

  // Chat view
  'No session selected': 'Сесію не вибрано',
  'Session ID — used for --resume': 'ID сесії — використовується для --resume',
  'Pick a session on the left to see its history.':
    'Виберіть сесію зліва, щоб переглянути її історію.',
  'New session ready — write the first message.':
    'Нова сесія готова — напишіть перше повідомлення.',
  'Reading transcript…': 'Читаю транскрипт…',
  'Show {count} earlier messages': 'Показати попередні {count} повідомлень',
  'This session has no messages to show.':
    'У цій сесії немає повідомлень для показу.',
  'live conversation': 'живий діалог',
  'Claude is thinking…': 'Клод думає…',

  // Session controls
  'Start a session with Remote Control': 'Запустити сесію з Remote Control',
  'The session becomes controllable from your other devices. Claude will run commands in this directory on instructions from there.':
    'Сесія стане доступною для віддаленого керування з інших ваших пристроїв. Клод зможе виконувати команди в цьому каталозі за вказівками звідти.',
  'Session name (optional)': 'Назва сесії (необовʼязково)',
  'defaults to the host name': 'за замовчуванням — імʼя хоста',
  'Will run': 'Буде виконано',
  'Remote Control only works in an interactive session, so it opens in a terminal rather than this window.':
    'Remote Control працює лише в інтерактивній сесії, тому вона відкриється в терміналі, а не в цьому вікні.',
  Start: 'Запустити',
  'Open in terminal': 'Відкрити в терміналі',
  'Stop the process (SIGTERM)': 'Зупинити процес (SIGTERM)',
  Controls: 'Керування',
  'In terminal': 'У терміналі',
  'Open this session in a terminal via claude --resume':
    'Відкрити цю сесію в терміналі через claude --resume',
  'Terminal opened': 'Термінал відкрито',
  'Start a new interactive session with remote access':
    'Запустити нову інтерактивну сесію з віддаленим доступом',
  Folder: 'Каталог',
  Opened: 'Відкрито',
  'Resume command': 'Команда resume',
  'Copy claude --resume <id>': 'Скопіювати claude --resume <id>',
  Copied: 'Скопійовано',
  Transcript: 'Транскрипт',
  'Reveal the .jsonl file': 'Показати файл .jsonl',
  'Stop chat': 'Зупинити чат',
  'Terminate our CLI process': 'Завершити наш процес CLI',
  'Conversation stopped': 'Діалог зупинено',
  'Running processes': 'Активні процеси',
  'No sessions running.': 'Запущених сесій немає.',
  'Process {pid} stopped': 'Процес {pid} зупинено',
  'Remote Control session started in a terminal':
    'Сесію з Remote Control запущено в терміналі',

  // Misc
  'Reading commit…': 'Читаю коміт…',
  'Contents are identical.': 'Вміст не відрізняється.',
  '{count} identical lines': '{count} однакових рядків',

  // Command palette entries
  Session: 'Сесія',
  Search: 'Пошук',
  Go: 'Перехід',
  View: 'Вигляд',
  File: 'Файл',
  'Search chat history': 'Пошук по історії чатів',
  'Search code': 'Пошук по коду',
  'Open file': 'Відкрити файл',
  'Recent files': 'Нещодавні файли',
  'Go to symbol': 'Перейти до символу',
  'Hide terminal': 'Сховати термінал',
  'Show terminal': 'Показати термінал',
  'Files panel': 'Панель файлів',
  'Git panel': 'Панель git',
  'Problems panel': 'Панель проблем',
  'Tasks panel': 'Панель задач',
  'Close all files': 'Закрити всі файли',
  'Localhost preview': 'Прев’ю localhost',
  'Close second column': 'Закрити другу колонку',
  'Compare session branches': 'Порівняти гілки сесій',

  // Relative time
  'just now': 'щойно',
  '{n}m ago': '{n} хв тому',
  '{n}h ago': '{n} год тому',
  '{n}d ago': '{n} дн тому',
  resetting: 'скидається',
  '{n}m': '{n} хв',
  '{n}h': '{n} год',
  '{h}h {m}m': '{h} год {m} хв',
  '{d}d {h}h': '{d} дн {h} год',

  // Attachments
  'Could not read the file': 'Не вдалося прочитати файл',
  image: 'зображення',
  'larger than 5 MB': 'більше 5 МБ',
  'pasted image.png': 'вставлене зображення.png',
  'could not be read': 'не вдалося прочитати',
  'unknown path, attach via the button': 'невідомий шлях, прикріпіть через кнопку',

  // Chat state
  'At most {max} attachments': 'Максимум {max} вкладень',
  'Only {count} added: the limit is {max}': 'Додано лише {count}: більше {max} не можна',
  'Turn interrupted': 'Хід перервано',
  Language: 'Мова',

  // Export
  'Export session…': 'Експортувати сесію…',
  'Export session': 'Експорт сесії',
  Export: 'Експортувати',
  'For a pull request, an issue or a gist.': 'Для пул-реквесту, ішʼю чи gist.',
  'Self-contained page, opens anywhere.': 'Самодостатня сторінка, відкриється будь-де.',
  'Redact secrets and paths': 'Прибрати секрети та шляхи',
  'API keys, tokens, e-mail addresses; your home directory becomes ~.':
    'Ключі API, токени, адреси пошти; домашня тека стає ~.',
  'Include tool calls': 'Додати виклики інструментів',
  'Folded away, but they make the document much longer.':
    'Вони згорнуті, але сильно збільшують документ.',
  'Include thinking': 'Додати роздуми',
  'Reasoning blocks, when the transcript has them.':
    'Блоки міркувань, якщо вони є в транскрипті.',
  'Without redaction the file keeps absolute paths and anything secret a tool printed.':
    'Без очищення у файлі лишаться абсолютні шляхи й усе секретне, що вивів інструмент.',
  'Redaction on': 'Очищення увімкнено',

  // Worktrees
  Worktrees: 'Робочі дерева',
  'Worktrees — run agents on several branches at once':
    'Робочі дерева — кілька агентів на різних гілках водночас',
  'No worktrees — this directory is not a git repository.':
    'Робочих дерев немає — ця тека не є git-репозиторієм.',
  detached: 'відірваний HEAD',
  'main tree': 'основне дерево',
  'directory missing': 'теки немає',
  'Start a session here': 'Почати тут сесію',
  'Open in the file tree': 'Відкрити у дереві файлів',
  'The main worktree cannot be removed': 'Основне дерево видалити не можна',
  'Remove worktree': 'Видалити дерево',
  'Remove {path}?': 'Видалити {path}?',
  'Discards uncommitted changes in that directory':
    'Відкидає незакоммічені зміни в тій теці',
  'Remove and discard changes': 'Видалити разом зі змінами',
  'Branch name': 'Назва гілки',
  'Check out': 'Переключитись',
  'Directory for the worktree': 'Тека для робочого дерева',
  'This branch is already checked out in another worktree.':
    'Ця гілка вже вивантажена в іншому робочому дереві.',
  'This branch exists — it will be checked out into the new directory.':
    'Така гілка вже є — її буде вивантажено в нову теку.',
  'A sibling directory, so the worktree stays out of the repository’s own listings.':
    'Тека-сусідка, щоб дерево не потрапляло у власні лістинги репозиторію.',

  // Environment editing
  'Configure MCP servers and hooks': 'Налаштувати MCP-сервери та хуки',
  everywhere: 'усюди',
  'this project': 'цей проєкт',
  'this project, only me': 'цей проєкт, лише я',
  '{path} is not valid JSON — fix it by hand before editing here.':
    '{path} не є коректним JSON — виправте вручну, перш ніж редагувати тут.',
  'Press refresh to check which servers are configured and reachable.':
    'Натисніть оновлення, щоб перевірити, які сервери налаштовані й доступні.',
  'Remove server': 'Видалити сервер',
  'No hooks configured.': 'Хуків не налаштовано.',
  'Remove hook': 'Видалити хук',
  'Command, e.g. npx -y @modelcontextprotocol/server-github':
    'Команда, напр. npx -y @modelcontextprotocol/server-github',
  'URL of the server': 'URL сервера',
  'Matcher, e.g. Edit|Write': 'Фільтр, напр. Edit|Write',
  'Shell command to run': 'Команда оболонки для запуску',
  'none yet': 'ще немає',
  Add: 'Додати',

  // Phone access
  'Phone access': 'Доступ із телефона',
  'Let a phone drive this session': 'Дозволити керувати сесією з телефона',
  'Starts a small server on your local network. Off by default.':
    'Піднімає невеликий сервер у локальній мережі. Типово вимкнено.',
  '{count} connected': 'підключено: {count}',
  'Or open by hand': 'Або відкрийте вручну',
  '…then enter this code': '…і введіть цей код',
  'Scan to open the session — no code needed.':
    'Скануйте — сесія відкриється одразу, код вводити не треба.',
  anywhere: 'звідусіль',
  tailnet: 'tailnet',
  'this network': 'ця мережа',
  'No network address — is Wi-Fi on?': 'Немає мережевої адреси — чи ввімкнено Wi-Fi?',
  'New code': 'Новий код',
  expired: 'протерміновано',
  copied: 'скопійовано',
  Copy: 'Копіювати',
  'Anyone on this network who has the code can make Claude run commands here. The connection is not encrypted — keep it to networks you trust, and never forward the port.':
    'Будь-хто в цій мережі, хто має код, зможе запускати тут команди через Claude. Зʼєднання не шифроване — тримайте його лише в мережах, яким довіряєте, і ніколи не пробрасуйте порт назовні.',
  'Too many wrong codes — pairing is off until you issue a new one.':
    'Забагато невірних кодів — парування вимкнено, поки не видасте новий.',

  // Tunnel
  'Reachable from anywhere': 'Доступ звідусіль',
  'not installed': 'не встановлено',
  'own command': 'своя команда',
  'Nothing to install on the phone — a browser is enough. Traffic passes through Cloudflare, and some ISPs block this one outright.':
    'На телефон ставити нічого не треба — досить браузера. Трафік іде через Cloudflare, і частина провайдерів блокує цей варіант повністю.',
  'Needs cloudflared: brew install cloudflared, then reopen these settings.':
    'Потрібен cloudflared: brew install cloudflared, а тоді відкрийте ці налаштування знову.',
  'Rides plain ssh over port 443, which almost nothing blocks — nothing to install on either end. Free tunnels last 60 minutes and the address changes each time.':
    'Працює через звичайний ssh на порту 443, який майже ніде не ріжуть — ставити не треба нічого з жодного боку. Безкоштовний тунель живе 60 хвилин, і адреса щоразу нова.',
  'Any command that prints an https address. Use {port} where the local port belongs.':
    'Будь-яка команда, що друкує https-адресу. Пишіть {port} там, де має бути локальний порт.',
  'This address is on the open internet. The code is the only thing between a stranger and a shell on this machine — turn the tunnel off when you are done.':
    'Ця адреса у відкритому інтернеті. Код — єдине, що відділяє стороннього від шелу на цій машині; вимикайте тунель, коли закінчите.',

  // Tailscale
  'The address marked with a globe is on your tailnet — it works from mobile data too, without exposing anything to the internet.':
    'Адреса з глобусом — це ваш tailnet: працює й з мобільного інтернету, нічого не виставляючи назовні.',
  'Not needed — your tailnet address above already reaches this machine from anywhere, and keeps it off the open internet.':
    'Не потрібен — адреса tailnet вище вже дістає цю машину звідусіль, не виставляючи її у відкритий інтернет.',
  'Only devices signed into your tailnet can reach this, over an encrypted link. Anyone with the code can still make Claude run commands here.':
    'Дістатися сюди можуть лише пристрої, що ввійшли у ваш tailnet, і лише шифрованим каналом. Але той, хто має код, усе одно зможе запускати тут команди через Claude.'
}
