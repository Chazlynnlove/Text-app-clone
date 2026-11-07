var EditSession = CodeMirror.Doc;

// The devToolsAccessibleTextArea class was taken from chrome dev tools to help
// improve codemirror screen reader support for navigating around a document.
// https://github.com/ChromeDevTools/devtools-frontend/blob/0ddf8e4898701ab4174096707346d71cc5985268/front_end/text_editor/CodeMirrorTextEditor.js#L1736

// CodeMirror uses an offscreen <textarea> to detect input. Due to
// inconsistencies in the many browsers it supports, it simplifies things by
// regularly checking if something is in the textarea, adding those characters
// to the document, and then clearing the textarea. This breaks assistive
// technology that wants to read from CodeMirror, because the <textarea> that
// they interact with is constantly empty. Because we target chrome on
// chrome os, we can gaurantee consistent input events. This lets us leave the
// current line from the editor in our <textarea>.
// CodeMirror still expects a mostly empty <textarea>, so we pass CodeMirror a
// fake <textarea> that only contains the users input.
CodeMirror.inputStyles.devToolsAccessibleTextArea = class extends CodeMirror.inputStyles.textarea {
  /**
   * @type {window.CodeMirror.state.Compartment} for changing the language
   * dynamically to match the file extension.
   */
  this.langCompartment_ = new CodeMirror.state.Compartment();

  /**
   * @type {window.CodeMirror.state.Compartment} for changing the "Wrap lines"
   * setting dynamically.
   */
  this.lineWrappingCompartment_ = new CodeMirror.state.Compartment();

  /**
   * @type {window.CodeMirror.state.Compartment} for changing the "show line numbers"
   * setting dynamically.
   */
  this.lineNumbersCompartment_ = new CodeMirror.state.Compartment();

  /** @type {window.CodeMirror.state.Compartment} for setting light/dark mode. */
  this.themeCompartment_ = new CodeMirror.state.Compartment();

  const themeStyles = {
    "&": {
      backgroundColor: "var(--ta-background-color)",
      color: "var(--ta-editor-text-color)",
    },
    ".cm-content": {
      fontSize: "var(--ta-editor-font-size)",
      lineHeight: "1.2",
    },
    ".cm-gutter": {
      backgroundColor: "var(--ta-background-color)",
      color: "var(--ta-editor-line-number-text-color)",
      fontSize: "var(--ta-editor-font-size)",
      lineHeight: "1.2",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--ta-editor-text-color)",
    },
    ".cm-dropCursor": {
      borderLeftColor: "var(--ta-editor-text-color)",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--ta-editor-selection-focus-color) !important",
    },
    ".cm-selectionBackground": {
      backgroundColor: "var(--ta-editor-selection-color) !important",
    },
    ".cm-matchingBracket": {
      backgroundColor: "inherit !important",
      color: "var(--ta-editor-text-color) !important",
      borderBottom: "1px solid var(--ta-editor-text-color)",
    },
    ".cm-nonmatchingBracket": {
      backgroundColor: "inherit !important",
    },
    ".cm-line": {
      cursor: "auto",
    }
  };

  this.lightTheme_ = CodeMirror.view.EditorView.theme(themeStyles, {dark: false});
  this.darkTheme_ = CodeMirror.view.EditorView.theme(themeStyles, {dark: true});

  /**
   * Extensions don't need to be loaded here because we will always load a
   * state created by newState with setSession.
   * 
   * @type {window.CodeMirror.view.EditorView}
   */
  this.editorView_ = new CodeMirror.view.EditorView({
    doc: "",
    parent: editorElement,
  })

/**
 * @constructor
 * @param {DOM} elementId
 * @param {Settings} settings
 */
function EditorCodeMirror(editorElement, settings) {
  this.element_ = editorElement;
  this.settings_ = settings;
  this.currentSession_ = null;
  this.cm_ = CodeMirror(
      editorElement,
      {
        'value': '',
        'autofocus': true,
        'matchBrackets': true,
        'inputStyle': 'devToolsAccessibleTextArea',
        // this is 25 days in milliseconds, we set the poll interval to be
        // incredibly long so that a poll doesn't break our selection logic.
        // We can remove the need for the poll because we only target chrome on
        // chrome os which handles events consistently, the poll is for other
        // browsers with less reliable input events, which we can ignore here.
        'pollInterval': Math.pow(2, 31) - 1,
        'highlightSelectionMatches': {
          minChars: 1,
          delay: 0,
          caseInsensitive: true
        }
      });
  this.cm_.setSize(null, 'auto');
  this.cm_.on('change', this.onChange.bind(this));
  this.textarea_ = this.cm_.getInputField();
  this.prevInput_ = null;
  this.setTheme();
  this.search_ = new Search(this.cm_);
  // Mimic Sublime behaviour there.
  this.defaultTabHandler_ = CodeMirror.commands.defaultTab;
}

EditorCodeMirror.EXTENSION_TO_MODE = {
    'bash': 'shell',
    'coffee': 'coffeeScript',
    'c': 'cpp',
    'c++': 'cpp',
    'cc': 'cpp',
    'cs': 'cpp',
    'css': 'css',
    'cpp': 'cpp',
    'cxx': 'cpp',
    'diff': 'diff',
    'gemspec': 'ruby',
    'go': 'go',
    'h': 'cpp',
    'hh': 'cpp',
    'hpp': 'cpp',
    'htm': 'html',
    'html': 'html',
    'java': 'java',
    'js': 'javascript',
    'json': 'json',
    'latex': 'stex',
    'less': 'less',
    'ltx': 'stex',
    'lua': 'lua',
    'markdown': 'markdown',
    'md': 'markdown',
    'patch': 'diff',
    'pgsql': 'sql',
    'pl': 'perl',
    'pm': 'perl',
    'php': 'php',
    'phtml': 'php',
    'py': 'python',
    'rb': 'ruby',
    'rdf': 'xml',
    'rs': 'rust',
    'rss': 'xml',
    'ru': 'ruby',
    'sh': 'shell',
    'sql': 'sql',
    'svg': 'xml',
    'tex': 'stex',
    'xhtml': 'html',
    'xml': 'xml',
    'yaml': 'yaml'};

/**
 * @param {SessionDescriptor} session
 * Change the current session, usually to switch to another tab.
 *
 * @param {EditorState} editorState
 * @param {string} fileExtension
 */
EditorCodeMirror.prototype.setSession = function(session) {
  this.cm_.swapDoc(session.codemirror);
  this.currentSession_ = session;
};

/**
 * @return {Search}
 * Return search object.
 */
EditorCodeMirror.prototype.getSearch = function() {
  return this.search_;
};

EditorCodeMirror.prototype.onChange = function() {
  $.event.trigger('docchange', {
    type: 'codemirror',
    session: this.currentSession_
  });
};

EditorCodeMirror.prototype.undo = function() {
  this.cm_.undo();
};

EditorCodeMirror.prototype.redo = function() {
  this.cm_.redo();
};

EditorCodeMirror.prototype.focus = function() {
  this.editorView_.focus();
};

/**
 * @param {SessionDescriptor} session
 * @param {string} extension
 */
EditorCodeMirror.prototype.setMode = function(session, extension) {
  session = session.codemirror;
  var mode = EditorCodeMirror.EXTENSION_TO_MODE[extension];
  if (mode) {
    const lang = window.CodeMirror.lang[mode];

    if (typeof lang === "object") {
      // Legacy parser
      extension = window.CodeMirror.language.StreamLanguage.define(lang);
    } else if (typeof lang === "function") {
      extension = lang();
    }
  }

  if (extension !== undefined) {
    this.editorView_.dispatch({
      effects: this.langCompartment_.reconfigure(extension)
    });
  } else {
    // Reset the language if no mode found.
    this.editorView_.dispatch({
      effects: this.langCompartment_.reconfigure([])
    });
  }
};

/** Apply all settings to the current state. */
EditorCodeMirror.prototype.applyAllSettings = function() {
  this.setTheme(this.settings_.get('theme'));
  this.setFontSize(this.settings_.get('fontsize'));
  this.showHideLineNumbers(this.settings_.get('linenumbers'));
  this.setReplaceTabWithSpaces(this.settings_.get('spacestab'));
  this.setTabSize(this.settings_.get('tabsize'));
  this.setWrapLines(this.settings_.get('wraplines'));
}

/**
 * @param {number} fontSize
 * Update font size from settings.
 */
EditorCodeMirror.prototype.setFontSize = function(fontSize) {
  // The "proper" way to do this might be to create a new theme, but this is
  // easier. Force a redraw so line numbers get positioned correctly.
  this.element_.style.setProperty('--ta-editor-font-size', fontSize + 'px');
  this.editorView_.setState(this.editorView_.state);
};

/**
 * @param {number} size
 */
EditorCodeMirror.prototype.setTabSize = function(size) {  
  const useSpace = this.settings_.get('spacestab');
  this.editorView_.dispatch({
    effects: [
      this.tabSizeCompartment_.reconfigure(window.CodeMirror.state.EditorState.tabSize.of(size)),
      this.getIndentUnitStateEffect(useSpace, size),
    ]
  });
};

/**
 * Creates a StateEffect that can be used to change the indent unit.
 * 
 * @param {boolean} useSpace If true the indent unit will be spaces. Otherwise it a tab character.
 * @param {number} tabSize Number of spaces equal to the size of a tab.
 */
EditorCodeMirror.prototype.getIndentUnitStateEffect = function(useSpace, tabSize) {
  const indentUnit = useSpace ? ' '.repeat(tabSize) : '\t';
  return this.indentUnitCompartment_.reconfigure(window.CodeMirror.language.indentUnit.of(indentUnit));
};

/**
 * @param {string} theme The color theme to change to. Default light.
 */
EditorCodeMirror.prototype.setTheme = function(theme) {
  this.editorView_.dispatch({
    effects: this.themeCompartment_.reconfigure(theme === "dark" ? this.darkTheme_ : this.lightTheme_),
  });
};

/**
 * @param {boolean} val Whether or not to show line numbers.
 */
EditorCodeMirror.prototype.showHideLineNumbers = function(val) {
  this.editorView_.dispatch({
    effects: this.lineNumbersCompartment_.reconfigure(val ? window.CodeMirror.view.lineNumbers() : [])
  });
};

/**
 * @param {boolean} val Whether or not to enable line wrapping.
 */
EditorCodeMirror.prototype.setWrapLines = function(val) {
  this.editorView_.dispatch({
    effects: this.lineWrappingCompartment_.reconfigure(val ? window.CodeMirror.view.EditorView.lineWrapping : [])
  });
};

/**
 * @param {boolean} useSpace Whether or not to indent with spaces. False means indent with tabs.
 */
EditorCodeMirror.prototype.setReplaceTabWithSpaces = function(useSpace) {
  const tabsize = this.settings_.get('tabsize');
  this.editorView_.dispatch({
    effects: [this.getIndentUnitStateEffect(useSpace, tabsize)],
  });
};

/**
 * @param {window.CodeMirror.view.ViewUpdate} update
 */
EditorCodeMirror.prototype.onViewUpdate = function(update) {
  if (update.docChanged) {
    $.event.trigger('docchange');
  }
};

EditorCodeMirror.prototype.disable = function() {
  this.editorView_.dispatch({
    effects: this.editableCompartment_.reconfigure(window.CodeMirror.view.EditorView.editable.of(false))
  });
};

EditorCodeMirror.prototype.enable = function() {
  this.editorView_.dispatch({
    effects: this.editableCompartment_.reconfigure(window.CodeMirror.view.EditorView.editable.of(true))
  });
};

/**
 * Prepare the Editor to be killed and removed from the DOM
 */
EditorCodeMirror.prototype.destory = function() {
  // By swapping out the doc for a empty one, codemirror detaches the current
  // doc so when the codemirror instance is deleted our document does not enter
  // a corrupted state where it still thinks it's attached to the edior.
  this.cm_.swapDoc(new CodeMirror.Doc(''));
};
