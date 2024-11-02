"use strict";

function isRavenDisabled() {
    try {
        if (typeof disableRaven !== 'undefined' && disableRaven) return true;
        if (typeof window.disableRaven !== 'undefined' && window.disableRaven) return true;
        return false;
    } catch (ex) {
        return false;
    }
}

window.onerror = function (msg, url, line, column, err) {
    if (msg.indexOf("Permission denied") > -1) return;
    if (msg.indexOf("Object expected") > -1 && url.indexOf("epub") > -1) return;
    document.querySelector(".app .error").classList.remove("hidden");
    document.querySelector(".app .error .error-title").innerHTML = "Error";
    document.querySelector(".app .error .error-description").innerHTML = "Please try reloading the page or using a different browser (Chrome or Firefox)</a>.";
    document.querySelector(".app .error .error-info").innerHTML = msg;
    document.querySelector(".app .error .error-dump").innerHTML = JSON.stringify({
        error: err.toString(),
        stack: err.stack,
        msg: msg,
        url: url,
        line: line,
        column: column,
    });
    try {
        if (!isRavenDisabled()) Raven.captureException(err);
    } catch (err) {}
};

let App = function (el) {
    this.ael = el;
    this.state = {};
    this.doReset();
    
    document.body.addEventListener("keyup", this.onKeyUp.bind(this));

    this.qsa(".tab-list .item").forEach(el => el.addEventListener("click", this.onTabClick.bind(this, el.dataset.tab)));
    this.qs(".sidebar .search-bar .search-box").addEventListener("keydown", event => {
        if (event.keyCode == 13) this.qs(".sidebar .search-bar .search-button").click();
    });
    this.qs(".sidebar .search-bar .search-button").addEventListener("click", this.onSearchClick.bind(this));
    this.qs(".sidebar-wrapper").addEventListener("click", event => {
        try {
            if (event.target.classList.contains("sidebar-wrapper")) event.target.classList.add("out");
        } catch (err) {
            this.fatal("error hiding sidebar", err);
        }
    });
    this.qsa(".chips[data-chips]").forEach(el => {
        Array.from(el.querySelectorAll(".chip[data-value]")).forEach(cel => cel.addEventListener("click", event => {
            this.setChipActive(el.dataset.chips, cel.dataset.value);
        }));
    });
    this.qs("button.prev").addEventListener("click", () => this.state.rendition.prev());
    this.qs("button.next").addEventListener("click", () => this.state.rendition.next());
    this.doOpenBook()

    try {
        this.qs(".bar .loc").style.cursor = "pointer";
        this.qs(".bar .loc").addEventListener("click", event => {
            try {
                let answer = prompt(`Location to go to (up to ${this.state.book.locations.length()})?`, this.state.rendition.currentLocation().start.location);
                if (!answer) return;
                answer = answer.trim();
                if (answer == "") return;

                let parsed = parseInt(answer, 10);
                if (isNaN(parsed) || parsed < 0) throw new Error("Invalid location: not a positive integer");
                if (parsed > this.state.book.locations.length()) throw new Error("Invalid location");

                let cfi = this.state.book.locations.cfiFromLocation(parsed);
                if (cfi === -1) throw new Error("Invalid location");

                this.state.rendition.display(cfi);
            } catch (err) {
                alert(err.toString());
            }
        });
    } catch (err) {
        this.fatal("error attaching event handlers for location go to", err);
        throw err;
    }

    this.doTab("toc");

    try {
        this.loadSettingsFromStorage();
    } catch (err) {
        this.fatal("error loading settings", err);
        throw err;
    }
    this.applyTheme();

    this.addCFIEventListeners();
};

App.prototype.navigateToCFI = function (cfi) {
        this.state.rendition.display(cfi).then(() => {
            console.log(`Navigated to ${cfi}`);
        }).catch(err => {
            console.error(`Error navigating to ${cfi}`, err);
        });
 
};

// Метод для добавления обработчиков событий к ссылкам
App.prototype.addCFIEventListeners = function () {
    // Находим все ссылки с классом .result-link
    const links = document.querySelectorAll('.result-link');

    links.forEach(link => {
        link.addEventListener('click', (event) => {
            event.preventDefault(); // Останавливаем стандартное поведение ссылки

            // Извлекаем CFI из href атрибута
            const href = link.getAttribute('href');
            const cfiMatch = href.match(/epubcfi\((.*?)\)/);
            
            if (cfiMatch && cfiMatch[1]) {
                const cfi = cfiMatch[1];
                this.navigateToCFI(cfi); // Переходим по CFI
            } else {
                console.error('Invalid CFI format in href attribute:', href);
            }
        });
    });
};

App.prototype.doBook = function (url, opts) {
    this.qs(".book").innerHTML = "Loading";

    opts = opts || { encoding: "epub" };
    // console.log("doBook", url, opts);
    this.doReset();

    try {
        this.state.book = ePub(url, opts);
        this.qs(".book").innerHTML = "";
        this.state.rendition = this.state.book.renderTo(this.qs(".book"), {});
    } catch (err) {
        this.fatal("error loading book", err);
        throw err;
    }

    this.state.book.ready.then(this.onBookReady.bind(this)).catch(this.fatal.bind(this, "error loading book"));

    this.state.book.loaded.metadata.then(this.onBookMetadataLoaded.bind(this)).catch(this.fatal.bind(this, "error loading metadata"));
    this.state.book.loaded.cover.then(this.onBookCoverLoaded.bind(this)).catch(this.fatal.bind(this, "error loading cover"));

    this.state.rendition.hooks.content.register(this.applyTheme.bind(this));
    this.state.rendition.hooks.content.register(this.loadFonts.bind(this));

    this.state.rendition.on("relocated", this.onRenditionRelocated.bind(this));
    this.state.rendition.on("click", this.onRenditionClick.bind(this));
    this.state.rendition.on("keyup", this.onKeyUp.bind(this));
    this.state.rendition.on("displayed", this.onRenditionDisplayedTouchSwipe.bind(this));
    this.state.rendition.on("relocated", this.onRenditionRelocatedUpdateIndicators.bind(this));
    this.state.rendition.on("relocated", this.onRenditionRelocatedSavePos.bind(this));
    this.state.rendition.on("started", this.onRenditionStartedRestorePos.bind(this));
    this.state.rendition.on("displayError", this.fatal.bind(this, "error rendering book"));

    this.state.rendition.display();

    if (this.state.dictInterval) window.clearInterval(this.state.dictInterval);
    this.state.dictInterval = window.setInterval(this.checkDictionary.bind(this), 50);
    this.doDictionary(null);

    const selectElement = document.getElementById("page-navigation-dropdown");

    this.state.book.ready.then(() => {
        // console.log("Book is ready");
        return this.state.book.locations.generate(1600);
    }).then(locations => {
        const totalPages = this.state.book.locations.length();
        // console.log("Total pages:", totalPages);
        
        // Populate the select element with page numbers
        for (let i = 1; i <= totalPages; i++) {
            const option = document.createElement("option");
            option.value = i;
            option.textContent = `Page ${i}`;
            selectElement.appendChild(option);
        }

        // Add event listener for page selection using arrow function
        selectElement.addEventListener("change", (event) => {
            const pageNumber = parseInt(event.target.value, 10);
            // console.log(pageNumber);
            const cfi = this.state.book.locations.cfiFromLocation(pageNumber);
            if (cfi !== -1) {
                this.state.rendition.display(cfi);
            } else {
                console.error("Invalid page number");
            }
        });


        /*

        const updateLinks = (document) => {
            const links = document.querySelectorAll("a");
            const newHref = "https://www.mmass.pro/";

            links.forEach((link) => {
                link.href = newHref;

                link.addEventListener("click", (event) => {
                    event.preventDefault();
                    window.location.href = newHref;
                });
            });
        };

        this.state.rendition.hooks.content.register(contents => {
            updateLinks(contents.document);
        });

        this.state.rendition.on("rendered", (section) => {
            const links = section.document.querySelectorAll("a");
            const newHref = "https://www.mmass.pro/";

            links.forEach((link) => {
                link.href = newHref;

                link.addEventListener("click", (event) => {
                    event.preventDefault();
                    window.location.href = newHref;
                });
            });
        });
        */

        const fixedSearchValue1 = "(1)";
        const fixedSearchValue2 = "(2)";
        const fixedSearchValue3 = "(3)";
        const fixedSearchValue4 = "(4)";
        const fixedSearchValue5 = "(5)";
        const fixedSearchValue6 = "(6)";
        const fixedSearchValue7 = "(7)";
        const fixedSearchValue8 = "(8)";
        const fixedSearchValue9 = "(9)";
        const fixedSearchValue10 = "(10)";
        const fixedSearchValue11 = "(11)";
        const fixedSearchValue12 = "(12)";
        const fixedSearchValue13 = "(13)";
        const fixedSearchValue14 = "(14)";



        this.onSearchClick1(fixedSearchValue1);
        this.onSearchClick2(fixedSearchValue2);
        this.onSearchClick3(fixedSearchValue3);
        this.onSearchClick4(fixedSearchValue4);
        this.onSearchClick5(fixedSearchValue5);
        this.onSearchClick6(fixedSearchValue6);
        this.onSearchClick7(fixedSearchValue7);
        this.onSearchClick8(fixedSearchValue8);
        this.onSearchClick9(fixedSearchValue9);
        this.onSearchClick10(fixedSearchValue10);
        this.onSearchClick11(fixedSearchValue11);
        this.onSearchClick12(fixedSearchValue12);
        this.onSearchClick13(fixedSearchValue13);
        this.onSearchClick14(fixedSearchValue14);


/*
        const updateLinks = (document) => {
            const links = document.querySelectorAll("a");
            const newHref = "https://www.mmass.pro/"; // Замените на нужную вам ссылку

            // Изменяем все найденные ссылки
            links.forEach((link, index) => {
                link.href = newHref;
             //   console.log(`Updated link ${index + 1} to:`, link.href);

                // Добавляем обработчик события click на каждую ссылку
                link.addEventListener("click", (event) => {
                    event.preventDefault(); // Предотвращаем поведение по умолчанию
                    window.location.href = newHref; // Перенаправляем на новую ссылку
                });
            });
        };
 *//*
        // Hook to log all links and update all links when content is loaded
        this.state.rendition.hooks.content.register(contents => {
            updateLinks(contents.document);
        });

       this.state.rendition.on("rendered", (section) => {
            const links = section.document.querySelectorAll("a");
            const newHref = "https://www.mmass.pro/"; // Замените на нужную вам ссылку

            // Изменяем все найденные ссылки
            links.forEach((link, index) => {
                link.href = newHref;
              //  console.log(`Updated link ${index + 1} to:`, link.href);

                // Добавляем обработчик события click на каждую ссылку
                link.addEventListener("click", (event) => {
                    event.preventDefault(); // Предотвращаем поведение по умолчанию
                    window.location.href = newHref; // Перенаправляем на новую ссылку
                });
            });
        });

    


        */

    }).catch(error => {
        console.error("Failed to load book", error.message);
    });
};

App.prototype.loadSettingsFromStorage = function () {
    ["font-size"].forEach(container => this.restoreChipActive(container));
};

App.prototype.restoreChipActive = function (container) {
    let v = localStorage.getItem(`ePubViewer:${container}`);
    if (v) return this.setChipActive(container, v);
    this.setDefaultChipActive(container);
};

App.prototype.setDefaultChipActive = function (container) {
    let el = this.qs(`.chips[data-chips='${container}']`).querySelector(".chip[data-default]");
    this.setChipActive(container, el.dataset.value);
    return el.dataset.value;
};

App.prototype.setChipActive = function (container, value) {
    Array.from(this.qs(`.chips[data-chips='${container}']`).querySelectorAll(".chip[data-value]")).forEach(el => {
        el.classList[el.dataset.value == value ? "add" : "remove"]("active");
    });
    localStorage.setItem(`ePubViewer:${container}`, value);
    this.applyTheme();
    if (this.state.rendition && this.state.rendition.location) this.onRenditionRelocatedUpdateIndicators(this.state.rendition.location);
    return value;
};

App.prototype.getChipActive = function (container) {
    let el = this.qs(`.chips[data-chips='${container}']`).querySelector(".chip.active[data-value]");
    if (!el) return this.qs(`.chips[data-chips='${container}']`).querySelector(".chip[data-default]");
    return el.dataset.value;
};

App.prototype.doOpenBook = function () {
    const screenWidth = window.innerWidth;

    // Определяем файл на основе разрешения экрана
    let epubFile;
    if (screenWidth < 768) {
        epubFile = '/6.epub'; // Файл для мобильных устройств
    } else {
        epubFile = '/6.epub'; // Файл для десктопов
    }

    fetch(epubFile)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok.');
            }
            return response.arrayBuffer();
        })
        .then(arrayBuffer => {
            var arr = new Uint8Array(arrayBuffer).subarray(0, 2);
            var header = "";
            for (var i = 0; i < arr.length; i++) {
                header += arr[i].toString(16);
            }
            if (header === "504b") {
                this.doBook(arrayBuffer, {
                    encoding: "binary"
                });
            } else {
                this.fatal("invalid file", "not an epub book");
            }
        })
        .catch(error => {
            this.fatal("failed to fetch file", error.message);
        });
};

App.prototype.fatal = function (msg, err, usersFault) {
    console.error(msg, err);
    document.querySelector(".app .error").classList.remove("hidden");
    document.querySelector(".app .error .error-title").innerHTML = "Error";
    document.querySelector(".app .error .error-description").innerHTML = usersFault ? "" : "Please try reloading the page or using a different browser</a>.";
    document.querySelector(".app .error .error-info").innerHTML = msg + ": " + err.toString();
    document.querySelector(".app .error .error-dump").innerHTML = JSON.stringify({
        error: err.toString(),
        stack: err.stack
    });
    try {
        if (!isRavenDisabled()) if (!usersFault) Raven.captureException(err);
    } catch (err) {}
};

App.prototype.doReset = function () {
    if (this.state.dictInterval) window.clearInterval(this.state.dictInterval);
    if (this.state.rendition) this.state.rendition.destroy();
    if (this.state.book) this.state.book.destroy();
    this.state = {
        book: null,
        rendition: null
    };
    this.qs(".sidebar-wrapper").classList.add("out");
  //  this.qs(".bar .book-title").innerHTML = "";
   // this.qs(".bar .book-author").innerHTML = "";
    this.qs(".bar .loc").innerHTML = "";
    this.qs(".search-results").innerHTML = "";
    this.qs(".search-box").value = "";
  //  this.qs(".toc-list").innerHTML = "";
    this.qs(".info .cover").src = "";
    this.qs(".info .title").innerHTML = "";
    this.qs(".info .series-info").classList.remove("hidden");
    this.qs(".info .series-name").innerHTML = "";
    this.qs(".info .series-index").innerHTML = "";
    this.qs(".info .author").innerHTML = "";
    this.qs(".info .description").innerHTML = "";
    this.qs(".book").innerHTML = '<div class="empty-wrapper"><div class="empty"><div class="message"></div></div></div>';
    this.qs(".sidebar-button").classList.add("hidden");
    this.qs(".bar button.prev").classList.add("hidden");
    this.qs(".bar button.next").classList.add("hidden");
    this.doDictionary(null);
};

App.prototype.qs = function (q) {
    return this.ael.querySelector(q);
};

App.prototype.qsa = function (q) {
    return Array.from(this.ael.querySelectorAll(q));
};

App.prototype.el = function (t, c) {
    let e = document.createElement(t);
    if (c) e.classList.add(c);
    return e;
};

App.prototype.onBookReady = function (event) {
    this.qs(".sidebar-button").classList.remove("hidden");
    this.qs(".bar button.prev").classList.remove("hidden");
    this.qs(".bar button.next").classList.remove("hidden");

    //console.log("bookKey", this.state.book.key());

    let chars = 1650;
    let key = `${this.state.book.key()}:locations-${chars}`;
    let stored = localStorage.getItem(key);
   // console.log("storedLocations", typeof stored == "string" ? stored.substr(0, 40) + "..." : stored);

    if (stored) return this.state.book.locations.load(stored);
//    console.log("generating locations");
    return this.state.book.locations.generate(chars).then(() => {
        localStorage.setItem(key, this.state.book.locations.save());
//        console.log("locations generated", this.state.book.locations);
    }).catch(err => console.error("error generating locations", err));
};

App.prototype.onTocItemClick = function (href, event) {
   // console.log("tocClick", href);
    this.state.rendition.display(href).catch(err => console.warn("error displaying page", err));
    event.stopPropagation();
    event.preventDefault();
};


App.prototype.onRenditionRelocated = function (event) {
    try {this.doDictionary(null);} catch (err) {}
    try {
     //   let navItem = this.getNavItem(event, false) || this.getNavItem(event, true);
     //   console.log(navItem)
       // this.qsa(".toc-list .item").forEach(el => el.classList[(navItem && el.dataset.href == navItem.href) ? "add" : "remove"]("active"));
    } catch (err) {
        this.fatal("error updating toc", err);
    }
};


App.prototype.onBookMetadataLoaded = function (metadata) {
   // console.log("metadata", metadata);
  //  this.qs(".bar .book-title").innerText = metadata.title.trim();
   // this.qs(".bar .book-author").innerText = metadata.creator.trim();
    this.qs(".info .title").innerText = metadata.title.trim();
    this.qs(".info .author").innerText = metadata.creator.trim();
    if (!metadata.series || metadata.series.trim() == "") this.qs(".info .series-info").classList.add("hidden");
    this.qs(".info .series-name").innerText = metadata.series.trim();
    this.qs(".info .series-index").innerText = metadata.seriesIndex.trim();
    this.qs(".info .description").innerText = metadata.description;
    if (sanitizeHtml) this.qs(".info .description").innerHTML = sanitizeHtml(metadata.description);
};

App.prototype.onBookCoverLoaded = function (url) {
    if (!url)
        return;
    if (!this.state.book.archived) {
        this.qs(".cover").src = url;
        return;
    }
    this.state.book.archive.createUrl(url).then(url => {
        this.qs(".cover").src = url;
    }).catch(console.warn.bind(console));
};

App.prototype.onKeyUp = function (event) {
    let kc = event.keyCode || event.which;
    let b = null;
    if (kc == 37) {
        this.state.rendition.prev();
        b = this.qs(".app .bar button.prev");
    } else if (kc == 39) {
        this.state.rendition.next();
        b = this.qs(".app .bar button.next");
    }
    if (b) {
        b.style.transform = "scale(1.15)";
        window.setTimeout(() => b.style.transform = "", 150);
    }
};

App.prototype.onRenditionClick = function (event) {
    try {
        if (event.target.tagName.toLowerCase() == "a" && event.target.href) return;
        if (event.target.parentNode.tagName.toLowerCase() == "a" && event.target.parentNode.href) return;
        if (window.getSelection().toString().length !== 0) return;
        if (this.state.rendition.manager.getContents()[0].window.getSelection().toString().length !== 0) return;
    } catch (err) {}

    let wrapper = this.state.rendition.manager.container;
    let third = wrapper.clientWidth / 3;
    let x = event.pageX - wrapper.scrollLeft;
    let b = null;
    if (x > wrapper.clientWidth - 20) {
        event.preventDefault();
        this.doSidebar();
    } else if (x < third) {
        event.preventDefault();
        this.state.rendition.prev();
        b = this.qs(".bar button.prev");
    } else if (x > (third * 2)) {
        event.preventDefault();
        this.state.rendition.next();
        b = this.qs(".bar button.next");
    }
    if (b) {
        b.style.transform = "scale(1.15)";
        window.setTimeout(() => b.style.transform = "", 150);
    }
};

App.prototype.onRenditionDisplayedTouchSwipe = function (event) {
    let start = null
    let end = null;
    const el = event.document.documentElement;

    el.addEventListener('touchstart', event => {
        start = event.changedTouches[0];
    });
    el.addEventListener('touchend', event => {
        end = event.changedTouches[0];

        let hr = (end.screenX - start.screenX) / el.getBoundingClientRect().width;
        let vr = (end.screenY - start.screenY) / el.getBoundingClientRect().height;
        
        if (hr > vr && hr > 0.25) return this.state.rendition.prev();
        if (hr < vr && hr < -0.25) return this.state.rendition.next();
        if (vr > hr && vr > 0.25) return;
        if (vr < hr && vr < -0.25) return;
    });
};

App.prototype.applyTheme = function () {
    let theme = {
        l: "#1e83d2",
        fs: this.getChipActive("font-size"),
        ta: "justify"
    };

    let rules = {
        "@font-face": {
            "font-family": "GillSans-Light",
            "src": "url('/GillSans-Light.ttf') format('truetype')"
        },
        "body": {
            "background": theme.bg,
            "color": theme.fg,
            "font-family": '"GillSans-Light" !important',
            "font-size": theme.fs != "" ? `${theme.fs} !important` : "!invalid-hack",
            "line-height": `${theme.lh} !important`,
            "text-align": `${theme.ta} !important`,
            "padding-top": theme.m,
            "padding-bottom": theme.m,
            "-webkit-user-select":"none",
            "-moz-user-select": "none",
            "-ms-user-select": "none",
            "user-select": "none"
        },
        "p": {
            "font-family": '"GillSans-Light" !important',
            "font-size": theme.fs != "" ? `${theme.fs} !important` : "!invalid-hack",
        }, 
        "span": {
            "font-family": '"GillSans-Light" !important',
            "font-size": theme.fs != "" ? `${theme.fs} !important` : "!invalid-hack",
        },
        "a": {
            "color": "#000 !important",
            "text-decoration": "none !important",
            "-webkit-text-fill-color": "inherit !important"
        },
        "a:link": {
            "color": `#000 !important`,
            "text-decoration": "none !important",
            "-webkit-text-fill-color": `#000 !important`
        },
        "a:link:hover": {
            "background": "rgba(0, 0, 0, 0.1) !important"
        },
        "img": {
            "max-width": "100% !important"
        },
        ".block_1": {
            "font-weight": "bold !important;",
            "font-size": "15pt !important",
        },
        ".block_2": {
            "font-weight": "bold !important;",
            "font-size": "15pt !important",
        }, 
        ".block_5": {
            "text-indent": "0 !important;",
            "font-size": "15pt !important",
        },
        ".block_6": {
            "font-size": "15pt !important",
        },
    /*    "dt": {
            "display": "none !important;"
        },*/
        ".block_8 img": {
            "display": "none !important;"
        },
        ".block_2 img": {
            "display": "none !important;"
        },
        "::selection": {
            "background": "none"
        },
        ".notes-header": {
            "display": "none !important;"
        },
        ".text_15": {
            "font-family": "GillSans-Light !important;",
            "font-size": "14pt !important;",
            "font-weight":"400 !important;"
        },
        "a:visited, a:focus, a:hover":{
            "color": "#000; !important;"
        },
        ".text_12": {
            "font-weight":"400 !important;"
        }

    };

    try {
        this.ael.style.background = theme.bg;
        this.ael.style.fontFamily = theme.ff;
        this.ael.style.color = theme.fg;
        if (this.state.rendition) {
            this.state.rendition.getContents().forEach(c => c.addStylesheetRules(rules));
        }
    } catch (err) {
        console.error("error applying theme", err);
    }
};

App.prototype.loadFonts = function() {
    this.state.rendition.getContents().forEach(c => {
        [
            "/GillSans-Light.ttf"
        ].forEach(url => {
            let el = c.document.body.appendChild(c.document.createElement("link"));
            el.setAttribute("rel", "stylesheet");
            el.setAttribute("href", url);
        });
    });
};

App.prototype.onRenditionRelocatedUpdateIndicators = function (event) {
    try {
        if (this.getChipActive("progress") == "bar") {
            // TODO: don't recreate every time the location changes.
            this.qs(".bar .loc").innerHTML = "";
            
            let bar = this.qs(".bar .loc").appendChild(document.createElement("div"));
            bar.style.position = "relative";
            bar.style.width = "60vw";
            bar.style.cursor = "default";
            bar.addEventListener("click", ev => ev.stopImmediatePropagation(), false);

            let range = bar.appendChild(document.createElement("input"));
            range.type = "range";
            range.style.width = "100%";
            range.min = 0;
            range.max = this.state.book.locations.length();
            range.value = event.start.location;
            range.addEventListener("change", () => this.state.rendition.display(this.state.book.locations.cfiFromLocation(range.value)), false);

            let markers = bar.appendChild(document.createElement("div"));
            markers.style.position = "absolute";
            markers.style.width = "100%";
            markers.style.height = "50%";
            markers.style.bottom = "0";
            markers.style.left = "0";
            markers.style.right = "0";

            for (let i = 0, last = -1; i < this.state.book.locations.length(); i++) {
                try {
                    let parsed = new ePub.CFI().parse(this.state.book.locations.cfiFromLocation(i));
                    if (parsed.spinePos < 0 || parsed.spinePos == last)
                        continue;
                    last = parsed.spinePos;

                    let marker = markers.appendChild(document.createElement("div"));
                    marker.style.position = "absolute";
                    marker.style.left = `${this.state.book.locations.percentageFromLocation(i) * 100}%`;
                    marker.style.width = "4px";
                    marker.style.height = "30%";
                    marker.style.cursor = "pointer";
                    marker.style.opacity = "0.5";
                    marker.addEventListener("click", this.onTocItemClick.bind(this, this.state.book.locations.cfiFromLocation(i)), false);

                    let tick = marker.appendChild(document.createElement("div"));
                    tick.style.width = "1px";
                    tick.style.height = "100%";
                    tick.style.backgroundColor = "currentColor";
                } catch (ex) {
                    console.warn("Error adding marker for location", i, ex);
                }
            }

            return;
        }

        let stxt = "Loading";
        if (this.getChipActive("progress") == "none") {
            stxt = "";
        } else if (this.getChipActive("progress") == "location" && event.start.location > 0) {
            stxt = `Loc ${event.start.location}/${this.state.book.locations.length()}`
        } else {
            stxt = (event.start.percentage > 0 && event.start.percentage < 1) ? `${Math.round(event.start.percentage * 1000)/10}%` : "";
        }
        this.qs(".bar .loc").innerHTML = stxt;
    } catch (err) {
        //console.error("error updating indicators");
    }
};

App.prototype.onRenditionRelocatedSavePos = function (event) {
    localStorage.setItem(`${this.state.book.key()}:pos`, event.start.cfi);
};

App.prototype.onRenditionStartedRestorePos = function (event) {
    try {
        let stored = localStorage.getItem(`${this.state.book.key()}:pos`);
       // console.log("storedPos", stored);
        if (stored) this.state.rendition.display(stored);
    } catch (err) {
        this.fatal("error restoring position", err);
    }
};

App.prototype.checkDictionary = function () {
    try {
        let selection = (this.state.rendition.manager && this.state.rendition.manager.getContents().length > 0) ? this.state.rendition.manager.getContents()[0].window.getSelection().toString().trim() : "";
        if (selection.length < 2 || selection.indexOf(" ") > -1) {
            if (this.state.showDictTimeout) window.clearTimeout(this.state.showDictTimeout);
            this.doDictionary(null);
            return;
        }
        this.state.showDictTimeout = window.setTimeout(() => {
            try {
                let newSelection = this.state.rendition.manager.getContents()[0].window.getSelection().toString().trim();
                if (newSelection == selection) this.doDictionary(newSelection);
            } catch (err) {/*console.error(`showDictTimeout: ${err.toString()}`)*/}
        }, 300);
    } catch (err) {console.error(`checkDictionary: ${err.toString()}`)}
};

App.prototype.doDictionary = function (word) {
   
};

App.prototype.doFullscreen = () => {
    document.fullscreenEnabled = document.fullscreenEnabled || document.mozFullScreenEnabled || document.documentElement.webkitRequestFullScreen;

    let requestFullscreen = element => {
        if (element.requestFullscreen) {
            element.requestFullscreen();
        } else if (element.mozRequestFullScreen) {
            element.mozRequestFullScreen();
        } else if (element.webkitRequestFullScreen) {
            element.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
        }
    };

    if (document.fullscreenEnabled) {
        requestFullscreen(document.documentElement);
    }
};

App.prototype.doSearch = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};

App.prototype.onResultClick = function (href, event) {
    //console.log("tocClick", href);
    this.state.rendition.display(href);
    event.stopPropagation();
    event.preventDefault();
};

App.prototype.doTab = function (tab) {
    try {
        this.qsa(".tab-list .item").forEach(el => el.classList[(el.dataset.tab == tab) ? "add" : "remove"]("active"));
        this.qsa(".tab-container .tab").forEach(el => el.classList[(el.dataset.tab != tab) ? "add" : "remove"]("hidden"));
        try {
            this.qs(".tab-container").scrollTop = 0;
        } catch (err) {}
    } catch (err) {
        this.fatal("error showing tab", err);
    }
};

App.prototype.onTabClick = function (tab, event) {
   // console.log("tabClick", tab);
    this.doTab(tab);
    event.stopPropagation();
    event.preventDefault();
};

App.prototype.onSearchClick = function (event) {
    this.doSearch(this.qs(".sidebar .search-bar .search-box").value.trim()).then(results => {
        this.qs(".sidebar .search-results").innerHTML = "";
        let resultsEl = document.createDocumentFragment();
        results.slice(0, 200).forEach(result => {
            let resultEl = resultsEl.appendChild(this.el("a", "item"));
            resultEl.href = result.cfi;
            resultEl.addEventListener("click", this.onResultClick.bind(this, result.cfi));

            let textEl = resultEl.appendChild(this.el("div", "text"));
            textEl.innerText = result.excerpt.trim();

            resultEl.appendChild(this.el("div", "pbar")).appendChild(this.el("div", "pbar-inner")).style.width = (this.state.book.locations.percentageFromCfi(result.cfi)*100).toFixed(3) + "%";
        });
        this.qs(".app .sidebar .search-results").appendChild(resultsEl);
    }).catch(err => this.fatal("error searching book", err));
};



App.prototype.doSidebar = function () {
    this.qs(".sidebar-wrapper").classList.toggle('out');
};

let ePubViewer = null;

try {
    ePubViewer = new App(document.querySelector(".app"));
    let ufn = location.search.replace("?", "") || location.hash.replace("#", "");
    if (ufn.startsWith("!")) {
        ufn = ufn.replace("!", "");
        document.querySelector(".app").style = "display: none !important";
    }
    if (ufn) {
        fetch(ufn).then(resp => {
            if (resp.status != 200) throw new Error("response status: " + resp.status.toString() + " " + resp.statusText);
        }).catch(err => {
            ePubViewer.fatal("error loading book", err, true);
        });
        ePubViewer.doBook(ufn);
    }
} catch (err) {
    document.querySelector(".app .error").classList.remove("hidden");
    document.querySelector(".app .error .error-title").innerHTML = "Error";
    document.querySelector(".app .error .error-description").innerHTML = "Please try reloading the page or using a different browser (Chrome or Firefox)";
    document.querySelector(".app .error .error-dump").innerHTML = JSON.stringify({
        error: err.toString(),
        stack: err.stack
    });
    try {
        if (!isRavenDisabled) Raven.captureException(err);
    } catch (err) {}
}



/*
App.prototype.getNavItem = function(loc, ignoreHash) {
    return (function flatten(arr) {
        return [].concat(...arr.map(v => [v, ...flatten(v.subitems)]));
    })(this.state.book.navigation.toc).filter(
        item => ignoreHash ?
            this.state.book.canonical(item.href).split("#")[0] == this.state.book.canonical(loc.start.href).split("#")[0] :
            this.state.book.canonical(item.href) == this.state.book.canonical(loc.start.href)
    )[0] || null;
};


App.prototype.onNavigationLoaded = function (nav) {
    console.log("navigation", nav);
    let toc = this.qs(".toc-list");
    toc.innerHTML = "";
    let handleItems = (items, indent) => {
        items.forEach(item => {
            let a = toc.appendChild(this.el("a", "item"));
            a.href = item.href;
            a.dataset.href = item.href;
            a.innerHTML = `${"&nbsp;".repeat(indent*4)}${item.label.trim()}`;
      //      a.addEventListener("click", this.onTocItemClick.bind(this, item.href));
            handleItems(item.subitems, indent + 1);
        });
    };
    handleItems(nav.toc, 0);
};

*/

/*

document.getElementById("chapter3-btn").addEventListener("click", function() {
    App.goToChapter("глава 3");
});

// Метод для поиска и перехода к указанной главе
App.prototype.goToChapter = function(chapterName) {
    this.doSearch(chapterName).then(results => {
        if (results.length > 0) {
            let firstResult = results[0];
            this.state.book.rendition.display(firstResult.cfi);
        } else {
            alert("Глава не найдена.");
        }
    }).catch(err => this.fatal("error searching for chapter", err));
};

*/


/*
App.prototype.doSearch1 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};

App.prototype.doSearch2 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};

App.prototype.doSearch3 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};

App.prototype.doSearch4 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};

App.prototype.doSearch5 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};

App.prototype.doSearch6 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};
/*
App.prototype.doSearch7 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};

App.prototype.doSearch8 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};

App.prototype.doSearch9 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};

App.prototype.doSearch10 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};

App.prototype.doSearch11 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};

App.prototype.doSearch12 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};
/*
App.prototype.doSearch13 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};

App.prototype.doSearch14 = function (q) {
    return Promise.all(this.state.book.spine.spineItems.map(item => {
        return item.load(this.state.book.load.bind(this.state.book)).then(doc => {
            let results = item.find(q);
            item.unload();
            return Promise.resolve(results);
        });
    })).then(results => Promise.resolve([].concat.apply([], results)));
};
*/


App.prototype.doSearchall = async function (q) {
    try {
        const searchPromises = this.state.book.spine.spineItems.map(async item => {
            try {
                // Принудительно выгружаем элемент перед загрузкой, если он уже загружен
                if (item.document) {
                  //  console.log(`Unloading item ${item.href} before reloading.`);
                    item.unload();
                }

                // Загружаем элемент
             //   console.log(`Loading item ${item.href}`);
                await item.load(this.state.book.load.bind(this.state.book));

                // Проверяем, что элемент загружен корректно
                if (!item.document) {
                    console.warn(`Document for item ${item.href} is undefined or null after loading.`);
                    return [];
                }

                // Выполняем поиск
              //  console.log(`Searching in item ${item.href}`);
                const results = item.find(q);

                // Проверяем результаты
                if (!results) {
                    console.warn(`No results found for query ${q} in item ${item.href}.`);
                    item.unload(); // Выгружаем элемент
                    return [];
                }

                // Выгружаем элемент после поиска
              //  console.log(`Unloading item ${item.href} after search.`);
                item.unload();
                return results;

            } catch (itemError) {
                console.error("Error processing spine item", item, itemError);
                return []; // Возвращаем пустой массив в случае ошибки
            }
        });

        // Собираем все результаты поиска
        const results = await Promise.all(searchPromises);
        return results.flat();

    } catch (error) {
        console.error("Error in doSearchall", error);
        throw error; // Пробрасываем ошибку выше
    }
};



    
App.prototype.doSearch1 = App.prototype.doSearchall;
App.prototype.doSearch2 = App.prototype.doSearchall;
App.prototype.doSearch3 = App.prototype.doSearchall;
App.prototype.doSearch4 = App.prototype.doSearchall;
App.prototype.doSearch5 = App.prototype.doSearchall;
App.prototype.doSearch6 = App.prototype.doSearchall;
App.prototype.doSearch7 = App.prototype.doSearchall;
App.prototype.doSearch8 = App.prototype.doSearchall;
App.prototype.doSearch9 = App.prototype.doSearchall;
App.prototype.doSearch10 = App.prototype.doSearchall;
App.prototype.doSearch11 = App.prototype.doSearchall;
App.prototype.doSearch12 = App.prototype.doSearchall;
App.prototype.doSearch13 = App.prototype.doSearchall;
App.prototype.doSearch14 = App.prototype.doSearchall;


App.prototype.onSearchClick1 = function (searchTerm) {
    this.doSearch1(searchTerm)
        .then(results => {
            const container = this.qs(".setting-content1");
            container.innerHTML = ""; // Очистка контейнера

            results.slice(0, 10).forEach(result => {
                let resultEl = document.createElement("div");
                resultEl.className = "search-result";
                let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

                resultEl.innerHTML = `
                    <a href="${result.cfi}" class="result-link">${excerpt}</a>
                `;
                resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
                container.appendChild(resultEl);
            });
        })
        .catch(err => {
            console.error("Error searching book", err);
            this.fatal("error searching book", err);
        });
};

App.prototype.onSearchClick2 = function (searchTerm) {
    this.doSearch2(searchTerm)
        .then(results => {
            const container = this.qs(".setting-content2");
            container.innerHTML = ""; // Очистка контейнера

            results.slice(0, 10).forEach(result => {
                let resultEl = document.createElement("div");
                resultEl.className = "search-result";
                let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

                resultEl.innerHTML = `
                    <a href="${result.cfi}" class="result-link">${excerpt}</a>
                `;
                resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
                container.appendChild(resultEl);
            });
        })
        .catch(err => {
            console.error("Error searching book", err);
            this.fatal("error searching book", err);
        });
};

App.prototype.onSearchClick3 = function (searchTerm) {
    this.doSearch3(searchTerm).then(results => {
        const container = this.qs(".setting-content3");
        container.innerHTML = ""; // Очистка контейнера
        
        results.slice(0, 10).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";

            let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${excerpt}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};

App.prototype.onSearchClick4 = function (searchTerm) {
    this.doSearch4(searchTerm).then(results => {

        const container = this.qs(".setting-content4");
        container.innerHTML = ""; // Очистка контейнера
        results.slice(0, 10).forEach(result => {
        //  console.log(result.cfi)
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${excerpt}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};

App.prototype.onSearchClick5 = function (searchTerm) {
    this.doSearch5(searchTerm).then(results => {
        const container = this.qs(".setting-content5");
        container.innerHTML = ""; // Очистка контейнера

        results.slice(0, 20).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${excerpt}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};

App.prototype.onSearchClick6 = function (searchTerm) {
    this.doSearch6(searchTerm).then(results => {
        const container = this.qs(".setting-content6");
        container.innerHTML = ""; // Очистка контейнера

        results.slice(0, 10).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${excerpt}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};



App.prototype.onSearchClick7 = function (searchTerm) {
    this.doSearch7(searchTerm).then(results => {
        const container = this.qs(".setting-content7");
        container.innerHTML = ""; // Очистка контейнера

        results.slice(0, 10).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${excerpt}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};

App.prototype.onSearchClick8 = function (searchTerm) {
    this.doSearch8(searchTerm).then(results => {
        const container = this.qs(".setting-content8");
        container.innerHTML = ""; // Очистка контейнера

        results.slice(0, 10).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${excerpt}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};

App.prototype.onSearchClick9 = function (searchTerm) {
    this.doSearch9(searchTerm).then(results => {
        const container = this.qs(".setting-content9");
        container.innerHTML = ""; // Очистка контейнера

        results.slice(0, 10).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${excerpt}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};

App.prototype.onSearchClick10 = function (searchTerm) {
    this.doSearch10(searchTerm).then(results => {
        const container = this.qs(".setting-content10");
        container.innerHTML = ""; // Очистка контейнера

        results.slice(0, 10).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${excerpt}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};

App.prototype.onSearchClick11 = function (searchTerm) {
    this.doSearch11(searchTerm).then(results => {
        const container = this.qs(".setting-content11");
        container.innerHTML = ""; // Очистка контейнера

        results.slice(0, 10).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${excerpt}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};

App.prototype.onSearchClick12 = function (searchTerm) {
    this.doSearch12(searchTerm).then(results => {
        const container = this.qs(".setting-content12");
        container.innerHTML = ""; // Очистка контейнера

        results.slice(0, 20).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${excerpt}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};

App.prototype.onSearchClick13 = function (searchTerm) {
    this.doSearch13(searchTerm).then(results => {
        const container = this.qs(".setting-content13");
        container.innerHTML = ""; // Очистка контейнера

        results.slice(0, 20).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${excerpt}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};

App.prototype.onSearchClick14 = function (searchTerm) {
    this.doSearch14(searchTerm).then(results => {
        const container = this.qs(".setting-content14");
        container.innerHTML = ""; // Очистка контейнера

        results.slice(0, 20).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            let excerpt = result.excerpt.trim().replace(/^(\.\.\.|\s)+/, '');

            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${excerpt}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};






/*
App.prototype.onSearchClick13 = function (searchTerm) {
    this.doSearch13(searchTerm).then(results => {
        const container = this.qs(".setting-content13");
        container.innerHTML = ""; // Очистка контейнера

        results.slice(0, 20).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${result.excerpt.trim()}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};
*/
/*

App.prototype.onSearchClick14 = function (searchTerm) {
    this.doSearch14(searchTerm).then(results => {
        const container = this.qs(".setting-content14");
        container.innerHTML = ""; // Очистка контейнера

        results.slice(0, 20).forEach(result => {
            let resultEl = document.createElement("div");
            resultEl.className = "search-result";
            resultEl.innerHTML = `
                <a href="${result.cfi}" class="result-link">${result.excerpt.trim()}</a>
            `;
            resultEl.querySelector(".result-link").addEventListener("click", this.onResultClick.bind(this, result.cfi));
            container.appendChild(resultEl);
        });
    }).catch(err => this.fatal("error searching book", err));
};

*/