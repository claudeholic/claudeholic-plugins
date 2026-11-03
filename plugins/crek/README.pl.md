[English](README.md) | **Polski**

# CREK — szukanie pracy z Claude Code

CREK (Claude Rekrutacje) to plugin do Claude Code dla osób szukających pracy. Kandydatem
jesteś Ty i Ty decydujesz. Claude wykonuje robotę: przeszukuje portale z ogłoszeniami, ocenia
oferty względem Twojego CV i kryteriów, pokazuje je w jednej tabeli, dopasowuje CV do oferty,
wypełnia formularz w prawdziwej przeglądarce i zapisuje każde zgłoszenie w bazie. Dzięki temu
kolejna sesja wie, co, gdzie i kiedy zostało wysłane.

> **Zrobiony pod rynek pracy IT w Polsce.** CREK działa po polsku i po angielsku, ale domyślne
> portale, wiedza o formularzach i formy umów są polskie. W innym kraju może być mniej skuteczny:
> portale z innych krajów da się teoretycznie dodać, ale nie jest to oczywiste — zob.
> [Portale i praca poza Polską](#portale-i-praca-poza-polską).
>
> **Polecenia po polsku działają najlepiej.** Skille uruchamiają się na frazy z ich opisów.
> Główne frazy są polskie, angielskie są dodatkiem, a Claude Code ich nie tłumaczy — zob.
> [Polecenia](#polecenia).

**System operacyjny.** Sam CREK nie jest związany z Linuksem i działa też pod Windows.
Ograniczeniem jest jego zależność `chrome-shared` (instalowana automatycznie) — przeglądarka,
w której CREK przeszukuje portale, wypełnia formularze i sprawdza karty — działająca tylko pod
Linuksem. Pod WSL powinno działać, ale nie zostało to sprawdzone. Pod Windows `chmod 600` nie
chroni configu ani pliku bazy, a sprawdzenie configu może za każdym razem ostrzegać o ich
uprawnieniach.

## Co potrafi

- **Przeszukuje portale** — domyślnie 25 (polskie portale IT, globalne portale z pracą zdalną,
  serwisy dla freelancerów, wyszukiwanie na stronach ATS-ów startupów). Odrzuca to, co wyraźnie
  nie jest Twoim typem roli, czyta resztę i sprawdza każde znalezisko z tym, co już widziałeś.
- **Ocenia ofertę względem Twojego CV** — ocena (1–10) to odsetek obowiązkowych wymagań oferty,
  które pokrywa Twoje główne CV, liczony zawsze tak samo. Sprawdza też twarde kryteria (forma
  umowy, minimalna stawka, tryb pracy, technologie, których nie chcesz): każde niespełnione
  kosztuje punkt i trafia na początek Minusów. Oferta zostaje na liście — to Ty decydujesz, czy
  ją skreślić.
- **Pokazuje oferty w jednej tabeli, po dziesięć** — `Tab | Oferta | Stawka | Dopasow. | Plusy |
  Minusy | Komentarze`. Każda oferta z partii jest otwarta w przeglądarce, kolumna Tab to numer
  karty. Plusy i Minusy to pokryte i brakujące wymagania, nie opinie. W Komentarzach są Twoje
  wcześniejsze decyzje i sugestia Claude.
- **Wyłapuje powtórki i zamknięte ogłoszenia** — ta sama praca często wraca przez inny portal
  albo inną agencję. CREK porównuje adresy, numery referencyjne i identyfikatory formularzy.
  Udowodniona powtórka trafia do bazy jako duplikat, prawdopodobna powtórka czegoś, na co już
  aplikowałeś, ląduje pod tabelą, słabsze podejrzenie — w Komentarzach. To, czy oferta wciąż
  przyjmuje zgłoszenia, jest sprawdzane przy skanie i jeszcze raz tuż przed pokazaniem partii.
- **Dopasowuje CV do oferty** — zmienia kolejność i sformułowania tego, co już jest w Twoim CV.
  Każdy wariant to mały skrypt w Pythonie, który tworzy HTML drukowany do PDF.
- **Wypełnia formularze** — Ashby, Greenhouse, Traffit, Personio, eRecruiter, Pracuj.pl, LinkedIn
  i zwykłe formularze, każdy z opisanymi pułapkami. Przepisuje dane z CV do formularza; odpowiedzi,
  w których liczy się ton, najpierw przygotowuje do Twojej akceptacji.
- **Prowadzi bazę zgłoszeń** — jeden wiersz na ofertę: status (nowe, wysłane, rozmowa, oferta,
  odrzucone, odmówione, pominięte, zamknięte, duplikat), stawki, wysłane CV, kontakty i datowany
  zapis rozmów. Opcjonalny interfejs WWW pokazuje te same dane.

## Wymagania

| Co | Po co | Kiedy |
|---|---|---|
| Linux — dla `chrome-shared` | `chrome-shared` korzysta z narzędzi linuksowych i nie obsługuje macOS ani Windows; własne skrypty CREK nie są związane z Linuksem. Pod WSL powinno działać, ale nie zostało to sprawdzone | w praktyce zawsze: skanowanie, formularze i sprawdzanie zamknięcia działają w tej przeglądarce |
| [Claude Code](https://code.claude.com) z własnym kontem | uruchamia skille | zawsze |
| Node.js **>= 22.13** | skrypty (wbudowane `fetch`, `WebSocket`, `node:sqlite`) | zawsze (bez SQLite wystarczy >= 22) |
| plugin `chrome-shared` **>= 1.3.2** | przeglądarka, w której CREK czyta portale i wypełnia formularze (port CDP 9226, numery kart `[N]`) | zawsze — instaluje się jako zależność |
| Python 3 | buduje warianty CV (`assets/cv-template/build_cv.py`) | do dopasowywania CV |
| `pdftotext` (poppler-utils) | czyta główne CV | zalecany — bez niego CV jest czytane w przeglądarce |
| `pdftk` | usuwa numer karty z tytułu w metadanych PDF | opcjonalny — gdy go brak, pojawia się ostrzeżenie |
| klient `mysql` / `mariadb` | połączenie z bazą MySQL / MariaDB | tylko dla `db.backend: mysql` |
| PHP >= 7.4 (zalecane 8.x) z `pdo_sqlite` lub `pdo_mysql` (Debian/Ubuntu: `php-cli php-sqlite3`) | opcjonalny interfejs WWW | tylko dla interfejsu |
| MySQL >= 5.7.22 lub MariaDB >= 10.5 | baza MySQL | tylko dla `db.backend: mysql` albo interfejsu na serwerze z MySQL |
| plugin `linkedin-mcp` | narzędzia LinkedIn dla Claude | opcjonalny, zalecany |

Plugin niczego sam nie instaluje — żadnych pakietów npm, żadnych pobrań. Korzysta z wbudowanych
modułów Node i programów z tabeli.

## Instalacja

```
/plugin marketplace add claudeholic/claudeholic-plugins
/plugin install crek@claudeholic-plugins
```

`chrome-shared` instaluje się jako zależność. Opcjonalnie, ale zalecane:

```
/plugin install linkedin-mcp@claudeholic-plugins
```

Daje Claude narzędzia LinkedIn (wyszukiwanie, oferty, profile, wiadomości) przez Twoją własną
sesję LinkedIn. Bez niego każdy krok na LinkedIn idzie przez przeglądarkę i też działa.

Uruchamiaj Claude Code w osobnym katalogu (np. `~/szukanie-pracy`). CREK trzyma tam config, bazę
i CV.

## Przykładowa sesja

Polecenia wpisujesz w Claude Code. Liczby w poleceniach to numery kart z tabeli.

**1. Pierwsze uruchomienie.** Piszesz `przeskanuj portale`. Każde polecenie CREK najpierw szuka
`crek.config.json`; nie ma go, więc Claude proponuje krótki wywiad i nic innego nie robi, dopóki
config nie powstanie. Zadaje po kilka pytań naraz: o język raportów, Twoje dane kontaktowe, twarde
kryteria (formy umów, minimalna stawka, tryby pracy, odrzucane technologie), kryteria miękkie,
sposób podawania stawki, położenie głównego CV, odpowiedź na pytanie w formularzu, czy użyto AI,
zgodę na samodzielne zakładanie kont na portalach i wybór bazy (domyślnie SQLite). Potem czyta
Twoje CV, buduje z niego profil umiejętności, z którego liczone są oceny, zapisuje
`crek.config.json` (do odczytu tylko przez Ciebie) i tworzy bazę.

**2. Skan.** Jeszcze raz `przeskanuj portale`. Claude otwiera portale we wspólnej przeglądarce,
ustawia ich filtry, czyta oferty z krótkiej listy, sprawdza je z bazą, ocenia i zapisuje jako
`new`. To prawdziwe przeglądanie, strona po stronie, więc chwilę trwa.

**3. Tabela.** Pierwsze dziesięć ofert jest otwartych w kartach, a Ty dostajesz:

| Tab | Oferta | Stawka | Dopasow. | Plusy | Minusy | Komentarze |
|---|---|---|---|---|---|---|
| 21 | Contoso — Platform Engineer | 160–190/h | 8 | Kubernetes, Terraform, AWS | GitHub Actions (tylko GitLab CI) | aplikuj |
| 22 | Initech — DevOps Engineer (Fabrikam) | 22–26k/mies | 7 | CI/CD, Linux, Ansible | tylko UoP | aplikuj |
| 23 | Northwind — SRE | nie podano | 6 | Prometheus, Kubernetes | Go, dyżury 24/7 | wcześniej pominięte bez przeglądu (#412, 28.10) |
| … | | | | | | |

Pod tabelą: oferty, które już są w bazie, krótki werdykt (na co aplikować najpierw i dlaczego)
i lista przeszukanych portali. Licznik mówi, ile zostało (`10 z 37`).

**4. Twoja decyzja.** `21 i 24 wyślij, reszta odrzuć`. Oferty 21 i 24 idą do aplikowania;
pozostałe osiem z tej partii dostaje status `declined`. Nic poza tą partią się nie zmienia.

**5. Aplikowanie.** Przy każdej ofercie Claude jeszcze raz sprawdza bazę, wybiera albo buduje
wariant CV, otwiera formularz i wypełnia standardowe pola z configu. Nowy wariant CV i każda
odpowiedź opisowa (motywacja, „własnymi słowami”) czekają na Twoją akceptację. Zgłoszenie uznaje
za wysłane dopiero wtedy, gdy strona to potwierdzi. Potem mówi, co poszło gdzie, z jakim CV
i jaką stawką, i zapisuje to w bazie.

**6. Kolejne oferty.** `kolejne 10` zamyka stare karty i otwiera następną partię. `pomiń resztę`
odkłada pozostałe oferty bez decyzji (`skipped`) — jeśli późniejszy skan znowu je znajdzie, wrócą
jako nowe. „Odrzuć” i „pomiń” różnią się celowo.

**7. Co zostało wysłane.** `co wysłaliśmy` pokazuje tę samą tabelę dla ofert, na które
aplikowałeś. Opcjonalny interfejs WWW pokazuje całą bazę.

**Później:** `oceń ofertę: <link>` dla pojedynczej oferty, `rekruter się odezwał`, gdy napisze do
Ciebie rekruter, `zaktualizowałem CV` po zmianie CV.

## Polecenia

| Skill | Co robi | Frazy po polsku (główne) | Frazy po angielsku |
|---|---|---|---|
| `crek:job-scan` | przeszukuje portale | „poszukaj ofert”, „przeskanuj portale”, „skanuj”, „nowe oferty”, „co nowego na portalach”, „sprawdź justjoin / nofluffjobs / pracuj.pl”, „znajdź oferty DevOps” | search for jobs, scan the boards, check a specific board, find new offers |
| `crek:report` | pokazuje oferty z bazy, zapisuje Twoje decyzje o partii | „pokaż tabelę”, „otwórz pierwsze 10”, „co wysłaliśmy”, „pokaż wysłane”, „ile wysłaliśmy”, „status zgłoszeń”, „co jest otwarte”, „X wyślij, reszta odrzuć” | show the table, open the first 10, summary table, what did we send, what is open, send X, decline the rest |
| `crek:apply` | jedna oferta od początku do końca: ocena, CV, formularz, baza | „aplikuj”, „wyślij CV”, „wyślij zgłoszenie”, „oceń ofertę”, „czy ta oferta pasuje”, „przeanalizuj ogłoszenie”, „rekruter się odezwał”, „odpowiedz rekruterowi” | apply to a job, send the application, evaluate a posting, handle a recruiter's offer |
| `crek:profile` | czyta główne CV i odświeża profil umiejętności | „zmieniłem CV”, „zaktualizowałem CV”, „przeczytaj CV od nowa”, „odśwież profil umiejętności” | I updated my CV |

Krótkie polecenia — „następne” / "next", „kolejne 10” / "next 10", „pomiń resztę” / "skip the
rest", „zignoruj resztę” / "ignore the rest" — działają tylko zaraz po wyświetleniu listy CREK.

**Dlaczego polski jest pierwszy.** Claude Code wybiera skill, porównując Twoje polecenie z frazami
w jego opisie, i ich nie tłumaczy. Opisy skilli CREK mają najpierw frazy polskie, a angielskie
jako dodatek. Angielskie polecenie bliskie angielskim frazom zadziała; inaczej sformułowane albo
napisane w trzecim języku może nie uruchomić skilla. Wtedy wywołaj skill po nazwie —
`/crek:job-scan`, `/crek:report`, `/crek:apply`, `/crek:profile` — i napisz, czego chcesz.

## Portale i praca poza Polską

Domyślna lista jest w `assets/boards.json`: 8 polskich portali IT (justjoin.it, nofluffjobs,
pracuj.pl i inne), 11 portali globalnych i z pracą zdalną (LinkedIn, Indeed, Wellfound, RemoteOK,
…), 3 serwisy dla freelancerów i 3 wyszukiwania na stronach ATS-ów startupów (Ashby, Greenhouse,
Lever; wyszukiwarki często je blokują). Toptal i Turing.com są pominięte celowo: to sieci
weryfikujące kandydatów, a nie listy ofert. CREK przeszukuje tylko portale z tej listy — nie
szuka nowych.

**Dodanie portalu jest teoretycznie możliwe, ale nie jest oczywiste.** Sam wpis na liście nie
wystarczy, bo każdy portal ma swoje szczegóły, które trzeba sprawdzić osobno:

- **Które części adresu identyfikują ofertę.** Duplikaty są wykrywane przez porównanie adresów
  bez parametrów śledzących. Plugin ma jedną listę znanych parametrów śledzących (`utm_*`, `trk`,
  `refId`, …) i zostawia każdy inny parametr. Adresy z LinkedIn i Indeed są sprowadzane do
  identyfikatora oferty (`assets/crek-refs.mjs`). Portal, który dokleja własny parametr śledzący
  albo sesyjny, sprawia, że ta sama oferta wygląda jak dwie różne.
- **Jak wygląda zamknięte ogłoszenie.** Każdy portal mówi to inaczej („Oferta wygasła”, „Job
  expired 12.10.2026”, przekierowanie na stronę „nie znaleziono”). Skrypt zna sformułowania tylko
  portali z listy (`assets/crek-closed-rules.mjs`).
- **Numery referencyjne i identyfikatory formularzy.** Skrypty rozpoznają formaty znanych ATS-ów
  (Traffit, eRecruiter, Greenhouse, Lever, Ashby, Workday, Personio, …) i typowe etykiety po polsku
  i angielsku (`assets/crek-refs.mjs`).
- **Filtry wyszukiwania, daty i pułapki.** Które filtry zawężają listę, która data mówi, że
  ogłoszenie odświeżono, listy doładowywane przy przewijaniu, „zdalnie”, które znaczy „zdalnie
  w jednym kraju” — opisane osobno dla każdego portalu w `notes` w `assets/boards.json`
  i w materiałach skilli.
- **Formularze zgłoszeń.** Każdy ATS ma swoje pułapki, opisane osobno w
  `skills/apply/references/ats-playbook.md` — głównie ATS-y używane w Polsce i kilka globalnych.

Co CREK robi z portalem, którego nie zna: sprawdzenie zamknięcia zwraca `unknown` (chyba że
strona odpowie HTTP 404 albo 410) i Claude sam czyta stronę; numery referencyjne w nieznanym
formacie też rozpoznaje, czytając. To działa, ale wolniej i mniej powtarzalnie niż na portalach
z listy. Claude nigdy sam nie dopisuje fraz ani wzorców do pluginu ani do configu; te listy
zmieniają tylko autorzy pluginu.

Config tylko modyfikuje domyślną listę: `boards.disabled` wyłącza portale, `boards.override`
zmienia pola domyślnego portalu (zwykle `url` z Twoimi filtrami), `boards.extra` dodaje portale.

Jeśli potrzebujesz portali z innego kraju, autor może pomóc, ale potrzebuje Twojej współpracy:
ktoś musi sprawdzić te portale i ich ogłoszenia w praktyce. Załóż zgłoszenie (issue) w publicznym
repozytorium: <https://github.com/claudeholic/claudeholic-plugins/issues>.

## Wskazówki autora

To doświadczenia autora, nie gwarancje.

- CREK da się puścić niemal na pełnym automacie — znajdź oferty, aplikuj na wszystko powyżej
  danej oceny, dopasuj CV. Autor to odradza.
- Najlepiej sprawdza się w wyszukiwaniu ofert, wstępnej analizie i filtrowaniu oraz
  w przepisywaniu danych z CV do formularzy.
- Odpowiedzi na pytania otwarte wychodzą sztucznie. CREK je proponuje — sprawdzaj je i poprawiaj
  przed wysłaniem.
- Dopasowane CV wychodzą znacznie lepiej, ale przeczytaj każde przed wysłaniem: może zgubić
  istotny szczegół.
- Autor używa Opus 5.5 w głównej sesji, a Sonnet w agentach, które wyszukują i filtrują.
- Autor przepuścił przez CREK ponad 1400 ofert w 2,5 miesiąca.
- Interfejs WWW to dodatek. Codzienna praca odbywa się w Claude Code.

## Twoje dane — co zostaje lokalnie, a co nie

`crek.config.json`, baza i Twoje CV są na Twoim dysku (baza — ewentualnie na wybranym przez
Ciebie serwerze). Config i plik bazy SQLite powstają z prawami odczytu tylko dla Ciebie
(`chmod 600`); `crek-config-check.mjs` ostrzega, gdy ktoś inny może je czytać. Jeśli katalog
projektu jest repozytorium git, trzymaj je poza nim: pierwsze uruchomienie proponuje dopisanie ich
do `.gitignore`, a sprawdzenie configu ostrzega, gdy git je śledzi.

Ale to asystent AI: **wszystko, co Claude czyta, trafia do modelu**, czyli do API Anthropic, jako
część rozmowy. Dotyczy to `crek.config.json` — Twoich danych osobowych, kryteriów i **zapisanych
w nim sekretów** (haseł do portali w `credentials`, loginu do bazy w `db.auth`, tokenu API
w `db.token`) — a także ogłoszeń, CV i wierszy bazy, z którymi Claude pracuje. Plugin nie wysyła
niczego nigdzie indziej i nie ma telemetrii. Jeśli jakieś hasło nie może trafić do modelu, nie
wpisuj go do configu: zostaw wpis bez hasła, a Claude poprosi Cię o zalogowanie, gdy będzie
trzeba.

## Ryzyka — regulaminy portali

CREK steruje prawdziwą przeglądarką na stronach, które nie zawsze lubią automatyzację. Przeczytaj
to przed użyciem:

- **Automatyczne przeglądanie, wypełnianie formularzy i skanowanie może łamać regulaminy stron** —
  portali z ogłoszeniami, ATS-ów i LinkedIn — i skończyć się ograniczeniem albo blokadą konta.
- **Ochrona przed botami.** `chrome-shared` uruchamia Chrome bez flag automatyzacji. Gdy formularz
  mimo to uzna zgłoszenie za spam (niewidoczna reCAPTCHA i podobne), Claude ponawia raz, a potem
  przechodzi na przeglądarkę zapasową: **drugą Twoją przeglądarkę, na osobnym profilu,
  uruchomioną z portem debugowania** (`browser.cdp_fallback_port`). W praktyce to ona pozwala
  przejść takie sprawdzenia; to też część, która najłatwiej narusza regulamin strony. Używaj jej
  świadomie albo wcale. Świeży profil nie ma historii, więc sprawdzenie i tak może go odrzucić —
  to cena za nieodsłanianie Twojego codziennego profilu (następny punkt).
- **Port debugowania otwiera przeglądarkę dla każdego lokalnego programu.** Dopóki przeglądarka
  nasłuchuje na porcie debugowania, każdy proces na Twoim komputerze może nią sterować i czytać
  każdą stronę, na której jest zalogowana (poczta, bank, wszystko) — bez pytania o hasło. Nigdy nie
  otwieraj portu na codziennym profilu: uruchom **osobny profil** (`--user-data-dir=<osobny
  katalog>`, zalogowany tylko tam, gdzie wymaga tego zgłoszenie), trzymaj go **tylko na
  localhost** (domyślnie; nigdy `--remote-debugging-address=0.0.0.0`) i **zamknij tę przeglądarkę
  po wysłaniu formularza**.
- **LinkedIn ostro reaguje na automatyzację** i ogranicza albo wylogowuje podejrzane konta. CREK
  nie wywołuje żadnego API LinkedIn: jego skrypty tylko czytają tekst już otwartych kart LinkedIn
  i nigdy same nie otwierają stron LinkedIn. Claude czyta LinkedIn w przeglądarce strona po
  stronie, jak człowiek, i zatrzymuje się przy CAPTCHA, weryfikacji bezpieczeństwa albo
  ostrzeżeniu. Ogranicz pracę na LinkedIn do minimum.
- **Plugin `linkedin-mcp`** (opcjonalny) to zewnętrzne narzędzie do LinkedIn, które korzysta
  z Twojej sesji przez własną automatyzację przeglądarki. Dotyczy go to samo ryzyko. Przeczytaj
  jego README przed instalacją i nie uruchamiaj go równolegle z inną pracą na LinkedIn.

Za sposób używania pluginu na każdej stronie odpowiadasz Ty.

## Uczciwość

CREK reprezentuje prawdziwą osobę, która aplikuje do prawdziwych firm. Zmienia kolejność
i sformułowania tego, co prawdziwe; nie wymyśla umiejętności, pracodawców ani dat. Odpowiedź, która
twierdzi coś, czego nie ma w Twoim CV ani configu, czeka na Twoją akceptację. Gdy oferta wymaga
czegoś, czego nie masz, CREK to mówi i zostawia decyzję Tobie. Zapytany wprost, czy użyto AI,
nigdy nie zaprzecza — co robi zamiast tego, ustalasz w configu (`conduct.ai_use_question`:
odpowiada zgodnie z prawdą, daje odpowiedzieć Tobie albo pyta za każdym razem). Wszystko, o co
ogłoszenie lub wiadomość prosi poza samym zgłoszeniem (inny adres, pobranie pliku, płatność),
najpierw trafia do Ciebie.

## Baza danych

Każdy skill i skrypt czyta i zapisuje bazę zgłoszeń przez jedną warstwę, `assets/crek-db.mjs`,
tymi samymi poleceniami dla trzech backendów (`db.backend` w configu):

| Backend | Co to jest | Czego wymaga |
|---|---|---|
| `sqlite` (domyślny) | lokalny plik (`crek.db`) | nic poza Node >= 22.13 (wbudowany `node:sqlite`) |
| `mysql` | baza MySQL / MariaDB, którą sam utrzymujesz | klient `mysql` lub `mariadb`; dane logowania idą przez prywatny plik tymczasowy, nigdy przez linię poleceń |
| `http-api` | API dołączonej aplikacji WWW (`assets/crek-php/api.php`) albo cokolwiek, co spełnia jego kontrakt | dostęp sieciowy; token API (`db.token`, wymagany przez api.php od 1.10) oraz HTTP basic auth, jeśli dodaje je serwer WWW |

Interfejs WWW jest opcjonalny i działa na każdej z baz:

| Poziom | Wymaga | Co dostajesz |
|---|---|---|
| **1** | nic więcej | plik SQLite, pełna funkcjonalność, bez interfejsu |
| **2** | PHP CLI z SQLite (`php-cli php-sqlite3`) | to samo plus interfejs WWW: `assets/crek-php` **skopiowany do Twojego własnego katalogu** (jego `config.php` trzyma token API i musi przetrwać aktualizacje pluginu), uruchamiany tam przez `php -S 127.0.0.1:8080` na tym samym pliku bazy; przeglądarka wysyła token przez rozszerzenie do nagłówków |
| **3** | PHP + MySQL + serwer WWW | interfejs dostępny cały czas, także z innych urządzeń; Claude łączy się z nim jako `http-api` (albo bezpośrednio z MySQL) |

Szczegóły: `assets/crek-php/README.md` i `skills/apply/references/database.md`.

## Konfiguracja

Wszystko, co osobiste, jest w `crek.config.json`, tworzonym przez wywiad przy pierwszym
uruchomieniu; wszystko, co uniwersalne, jest w pluginie. Format jest opisany pole po polu
w `assets/crek.schema.json`. `assets/crek-config-check.mjs` sprawdza najważniejsze pola (ręcznie
napisane reguły, nie pełny walidator schematu), w tym to, czy profil umiejętności wciąż odpowiada
CV na dysku; skan i aplikowanie uruchamiają go przed startem. Pola dodane w nowszych wersjach są
opcjonalne: starszy config dalej działa, a sprawdzenie mówi, co nowego. Config możesz edytować
sam albo poprosić o to Claude.

## Język

Raporty, szkice i wiadomości idą w języku z `presentation.language` — kod (`pl`, `en`) albo nazwa
(`Polish`, `English`, `polski`). Brak wartości oznacza polski. Stałe sformułowania — nagłówki
tabeli, standardowe wartości komórek, frazy zapisywane w bazie, wyniki skryptów, interfejs WWW —
pochodzą z `assets/i18n.json`, gdzie są wbudowane angielski i polski. Język bez słownika dostaje
te sformułowania po angielsku.

Dwa wyjątki są po angielsku w każdym języku: komunikaty diagnostyczne skryptów (Claude tłumaczy
je w Twoim języku) i powody dopasowania, które sprawdzenie duplikatów wpisuje do notatek
wiersza. Interfejs WWW startuje w języku i motywie z jego `config.php` (`$ui_lang` = `pl` lub
`en`, `$ui_theme` = `dark` lub `light`; domyślnie polski i ciemny) i ma w nagłówku przełączniki
obu.

## Licencja

Copyright (C) 2026 Michal Dzwoniarski. GPL-3.0-only — zob. [LICENSE](LICENSE).

I część nieformalna, która nie jest warunkiem licencji i do niczego nie zobowiązuje: **jeśli ten
plugin pomógł Ci znaleźć pracę, postaw mi piwo.** Pięć euro, pięć dolarów, tyle, ile kosztuje
piwo u Ciebie. Wypiję za Twoje zdrowie w nowej pracy. Bez wyskakujących próśb, bez śledzenia —
po prostu miły gest.
