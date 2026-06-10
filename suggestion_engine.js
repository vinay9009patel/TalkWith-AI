// =============================================================================
// SUGGESTION ENGINE LOGIC
// =============================================================================

(function() {
  var _currentSuggestion = null;
  var _ticks = 0;
  var _lastManualActivity = 0; 

  function getSuggestions() {
    if (typeof userCustomSetupSuggestions !== 'undefined' && userCustomSetupSuggestions.length > 0) {
      return userCustomSetupSuggestions;
    }
    if (typeof rawSetupSuggestions !== 'undefined' && rawSetupSuggestions.length > 0) {
      return rawSetupSuggestions;
    }
    if (typeof ROLES_DATA !== 'undefined' && ROLES_DATA.length > 0) {
      return ROLES_DATA.map(r => ({ role: r.name, bios: r.topics }));
    }
    return [];
  }

  function getActionBios() {
    if (typeof rawDynamicActionBios !== 'undefined' && rawDynamicActionBios.length > 0) {
      return rawDynamicActionBios;
    }
    return ["glitches the timeline", "opens a portal", "hacks the system", "starts a mystery"];
  }

  function runCycle() {
    try {
      const roleInput = document.getElementById("chatRole");
      const bioInput = document.getElementById("chatBio");
      const setupSuggestions = getSuggestions();
      const dynamicActionBios = getActionBios();

      if (!roleInput || !bioInput || setupSuggestions.length === 0) return;

      const hasRole = roleInput.value.trim().length > 0;
      const hasBio = bioInput.value.trim().length > 0;
      const roleFocused = document.activeElement === roleInput;
      const bioFocused = document.activeElement === bioInput;

      // PAUSE LOGIC: If user typed manually in the last 2 seconds
      const timeSinceActivity = Date.now() - _lastManualActivity;
      const isUserTyping = timeSinceActivity < 2000;

      if (isUserTyping) {
        // While user is typing a role, prompt them to write their own topic
        if (hasRole && !hasBio) {
          bioInput.placeholder = "Write your topic...";
          bioInput.removeAttribute("data-suggestion");
        }
        return;
      }

      _ticks++;

      // CASE 1: No Role selected -> Cycle Role + Topic every 4 seconds (every 2nd tick)
      if (!hasRole && !hasBio && !roleFocused && !bioFocused) {
        if (_ticks % 2 !== 0 && _ticks > 1) return; 

        const randomIndex = Math.floor(Math.random() * setupSuggestions.length);
        const sugg = setupSuggestions[randomIndex];
        if (!sugg) return;

        _currentSuggestion = sugg;
        roleInput.placeholder = sugg.role || "Search roles...";
        roleInput.setAttribute("data-suggestion", sugg.role || "");
        
        if (sugg.bios && sugg.bios.length > 0) {
          const bioText = sugg.bios[Math.floor(Math.random() * sugg.bios.length)];
          bioInput.placeholder = bioText;
          bioInput.setAttribute("data-suggestion", bioText);
        }
      } 
      // CASE 2: Role is filled (Suggest, Dropdown, or Typing finished) -> Cycle Topics every 2 seconds
      else if (hasRole && !hasBio && !bioFocused) {
        const currentRoleVal = roleInput.value.trim().toLowerCase();
        
        // Find role with loose matching
        let matchedSugg = setupSuggestions.find(s => (s.role || "").trim().toLowerCase() === currentRoleVal);
        
        if (matchedSugg && matchedSugg.bios && matchedSugg.bios.length > 0) {
          const bioText = matchedSugg.bios[Math.floor(Math.random() * matchedSugg.bios.length)];
          bioInput.placeholder = bioText;
          bioInput.setAttribute("data-suggestion", bioText);
        } else {
          // Fallback to dynamic action-oriented topics
          const action = dynamicActionBios[Math.floor(Math.random() * dynamicActionBios.length)];
          let r = roleInput.value.trim().split(" ")[0]; 
          if (r.length > 15) r = r.substring(0, 15);
          const dynamicBioText = r + " " + action;
          bioInput.placeholder = dynamicBioText;
          bioInput.setAttribute("data-suggestion", dynamicBioText);
        }
      }
    } catch (e) {
      console.error("Suggestion cycle error:", e);
    }
  }

  // Initial trigger
  setTimeout(runCycle, 500);
  
  // Base interval 2s (Ticks used for CASE 1's 4s rotation)
  setInterval(runCycle, 2000);

  function initSuggestionClicks() {
    const roleInput = document.getElementById("chatRole");
    const bioInput = document.getElementById("chatBio");

    if (roleInput && !roleInput.dataset.suggestionInit) {
      roleInput.addEventListener("click", function() {
        // Only fill if empty and placeholder is a suggestion
        if (!this.value && this.placeholder && !this.placeholder.includes("Search") && !this.placeholder.includes("e.g.")) {
          this.value = this.getAttribute("data-suggestion") || this.placeholder;
          this.dispatchEvent(new Event('input'));
          
          if (typeof setChatGender === 'function' && !window.selectedAvatar) {
            setChatGender('female');
          }
          
          // RESET PAUSE: Clicked suggestion is NOT typing
          _lastManualActivity = 0;
          setTimeout(runCycle, 50); 
        }
      });
      
      // keydown definitely means manual user intent
      roleInput.addEventListener("keydown", function() {
        _lastManualActivity = Date.now();
      });
      
      roleInput.addEventListener("input", function(e) {
        // Only pause for REAL manual keyboard activity
        if (e.inputType) {
          _lastManualActivity = Date.now();
          if (this.value.trim().length > 0 && bioInput && !bioInput.value.trim()) {
             bioInput.placeholder = "Write your topic...";
          }
        } else {
          // Programmatic (Suggest button or selection) -> RESUME immediately
          _lastManualActivity = 0;
          setTimeout(runCycle, 50);
        }
      });

      roleInput.addEventListener("focus", function() {
        if (typeof filterRoles === 'function') filterRoles(this.value);
      });
      roleInput.dataset.suggestionInit = "true";
    }

    if (bioInput && !bioInput.dataset.suggestionInit) {
      bioInput.addEventListener("click", function() {
        if (!this.value && this.placeholder && !this.placeholder.includes("Write topic") && !this.placeholder.includes("Write your topic")) {
          this.value = this.getAttribute("data-suggestion") || this.placeholder;
          this.dispatchEvent(new Event('input'));
          _lastManualActivity = 0;
        }
      });
      
      bioInput.addEventListener("keydown", function() {
        _lastManualActivity = Date.now();
      });

      bioInput.addEventListener("input", function(e) {
        if (e.inputType) {
          _lastManualActivity = Date.now();
        } else {
          _lastManualActivity = 0;
        }
      });
      
      bioInput.dataset.suggestionInit = "true";
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSuggestionClicks);
  } else {
    initSuggestionClicks();
  }
  setInterval(initSuggestionClicks, 2000);

})();
