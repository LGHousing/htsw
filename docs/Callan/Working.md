Can we look into the state folder in the gui panel and help me understand what all the files are because right now it feels just like a dumping ground for many different systems and it's not super easy to isolate which file does what its kind of just like a grab bag for many different features throughout the project

1. Okay wait but the parsing pipeline you talk about is for ONE import.json, right? What cold parse do you talk about for ct reload?? you mean when we open a recent importable THAT's the cache for that parse? Why is that in the GUI folder? idk. I guess thats fine but it's definitely not "state". Importablepaths- what does this actually do?? whats the input what's the output? i'm not clear about that. Htslparse? bruh- why woudl this not be in code-view? and does this parsing logic just not straight up appear elsewhere in the project? im confused

2. Okay- color tables. and the diffState enum, which is, what? I coudl look but you need to be better at describing. "shared DiffState enum" tells me nothing. Sourcediff: Static Diff- source vs import cache, so like, the view pane? okay. LivePreview.ts- so is this in the import pane? Does thsi interact with the event emitter for progress and stuff from importer? Totally a different system! Wow. focusedLine.ts- what?????? genuinely have no clue what this is for

3. Okay- again this is ANOTHER subsystem. crazy. and right click context menus? for file rows? wait this is in the importabels tab in left panel?? but the queu is in the import tab in the right panel?

4. Okay- but theres two different "knowledge dots"- theres the knowledge pane which is gonna get a revamp soonish as sseen in a github issue and that is not used very much right now, and then tehres the knowledge dots in the importables tab which is definitely used to see whether an importable is up to date and this woudl work with sourceDiff right?

5. okay- whats MRU mean but anyway

6. index.ts What the fuck selection.ts okay? i still dont know what this file actually does though LOL nice

WHere the design is actually muddled- You think THIS is where the design is muddled???? Wow

fileMenu- What is fileMenu what is that what is menuAction context menus is oh thats in 3. im so confused

Jesus fuckign christ
Two parse caches???? God damn

1. Okay.
   ImportableSourcePath- i'm getting deja vu i swear this existed in the ct_module/src in like the cache folder or something but idk
   ok

2. Okay- but question: does current=blue actually work? anyway yeah
   sourceDiff- fine
   livePreview-ok erm ok is there any other godfile that also implements stuff like this or is this the main driver of the import pane event stream
   focusedLine- okay... sure- wait whats importController, isnt that the file that deals with that in GUI/right-panel or whatever wouldnt all thiss tuff be bttter suited for there- what if we did like the gui files and then the state files for each tab like we had import-tab/state etc just an idea

3. Uhhh okayyyyyyyyy?? You cant even right click on things in the queue what

4. Bruh...

5. ok

6. Riight, so... state!! but like, state for right-panel not global state, right?
   index.ts- grr

7. Smh- okay, yeah that def needs to be moved

8. Bruh. remove that shit
   Ok cool! still a terrible spot for it- also what tell me about the two representations in one file
   okay... colocation is a scary word!! jk idk um yeah

9. oh the TABS you can right lcick on the tabs?

10. Cool

Yeah let's um one more back and forth and then we cna start fixing stuff

2. live-importer strip? this is new terminology- via previewLinesforFile -> live-preview-body.ts wait so this is the live importer view. okay? sure.
   then what does this do? what's the decorators? what is details and summary and whats the difference between setLiveState and setPlanedOp and setLiveCurrent and what does code-veiew/decorators.ts where is that actually ued????

Im so confused which one is actually used

3. oka

wait

Okay- a decorator is just a styler, that makes sense, sure sure, but codeview is used where? is it used in both the view Pane and the live importer pane? thats the only two places i know code exists but they are two very differentr edndering systems

right so for the view tab the lines come from the files own parse- umm which is parsed where? and uh decorator is diffDecorator which is the sourceDiff file?

in import-tab lines come from previewLinesForFile? whats that do? and decorator is progressDecorator? I'm like more confused than i was before i fear

Okay, states and details seems kinda done
Oh summary is a flag
erm this is so confusing

Erm okay
this is so so bad

okay view tab can parse a file ebfore thef ile exists- What???? the fuck
Live strip is showing somethng that isnt a file yet? no its not LOL the view tab is only whats on your file system tf

Okay there's ONE rendering system?
Is this... not... bad?
i feel like it's not the best idea to tryt o compress those two ystem sinto one? am i wrong?

Okay the fac thtat its smeared across 7 files is actually crazy

---

okay and where is previewLine populated from?

Thats weird why does rep b exist cant we just edit rep a

Erm when you get a chance can you take a look at the barrel for index.ts in state im confused why we still have it and this freaky stuff // Cross-area re-exports kept so existing `from "../state"` call sites resolve
// without churn. Owners: knowledge rows live in `gui/knowledge/`, import-session
// progress in `gui/right-panel/import-tab/`.
export * from "../knowledge/rows";
export * from "../right-panel/import-tab/importProgress";

---

Maybe- just- on failure can we save what existed? is that a bad idea? im
     confused what scope A does. what are yous aying about scope b i shard? i dont
     want a new *.progerss.json at all that sounds like a terrible idea- but we can
     just save what we know is in housing righ tnow, right? like observed is always
     observed, all updates only make it more accurate to what's in housing  i dont
     think the right wording is to "invalidate it" after we start phase 2 applying
     its just to save the knowledge cahce well but thats like prettty performance
     intesnive if we save teh cache after each edit maybe so idk just like a save
     after phase 1 idk and if it fails... uhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh well idk

Wait explain to me how these import action callbacks work and this is only in Actions and Applydiff? and is applyDiff a good name for this file if it has all the stuff that does things? importAction being inside of applyDiff does that make sense from the outside? I'm a littleconfused wiht thhis naming convention and these things youa dded int he file

#1 Please rename menuFlows to menuUtils.
#2. please importAction to addAction- that's what it does, right? any other places where we are confusing import vs add?
#3. Why do we pass in nestedProgressScope to the acutal gui importer thingy that deals with that stuff? #1 nested stuff should be contained in action: Action, right? and #2 doesn't it feel like a misabstraction for the actual gui writer to know about fucking actionPaths (if im thinking what that is properly?)

---


Should we make an applyContext? something like that? that hold state? or what woudl applyContext hold. Can you help me understand where we'd put a system like that, what it'd do, and how it would interface with existing systems/or future systems that we will rework so that we minimize the scope issues that have gotten out of hand

Wait are we still going to have the writers emit the progress events...?

The writer should only call a method that represents the thing it needs done:


await options?.apply?.syncNestedActions("ifActions", {
    desired: action.ifActions,
    observed: current?.ifActions,
    baselineCurrent,
    offset,
});

Wait what? i'm confused- what do YOu mean by the writer, what does this code even do? im confused

Today the writer itself calls syncActionList(...) and passes path/progress/event stuff. That is the problem.

Wtf thats some weird recursion, right? syncActionList is what calls the writers, right?

Okay so the writer calls the callback and then the applyContext (still feel like we need a better name than this) runs synActionlist? i like tha


----- 
1. I agree! Still not 100% sure what the point of it is. What do callers call in sync.ts to start an import? 
2. Yeah this has always been a smell imo i dont think a string is best for that
3. Uh huh I agree but not 100% sure how we fix this i'm not good enough 
4. Uh Huh I also agree 100% but again not experienced enouhg to know what it does & how to fix it
5. Yeah..... I agree Ithis file has always been very very suspciious to me
6. For real!!!!

The smell is not that a plan exists. The smell is that actions/sync.ts owns too much of it. Better shape:


importSession
  -> prereadImportable
      -> prereadActionList
          -> readActionList
          -> diffActionList
          -> returns ActionListPlan

  -> applyImportablePlan
      -> applyActionListPlan
          -> applyActionListDiff

          in your shape diagrams can u please put what files they live in

          But applyActionListPlan probably belongs in actions/applyDiff.ts, because applying the plan is apply-layer work. Then sync.ts becomes a convenience facade: 
          yeah i agree it belongs in applyDiff
          what you mean by convenicence facade

string paths: yeah 
progress costs: idk what you mean by that but ok
progress reducer: erm ok
importSession: yeah this is a horrible file


---

 -> applyActionListPlan(...)
            should live in ct_module/src/housingSync/actions/applyDiff.ts

            -> applyActionListDiff(...)
                 lives in ct_module/src/housingSync/actions/applyDiff.ts

whyw e need both of these?

By “convenience facade” I mean sync.ts would be a small file that gives callers the easy API:


await syncActionList(ctx, desired, options);

Hmmm this is interesting like the importables/importSession doesnt have to do all the management it just calls syncActionList? or what

That is useful for ITEM/MENU/nested cases where the caller does not need to hold a plan between phases.

nvm i dont like that anymore i dont think thats a good idea to have sync.ts just for the special case whihc we will move off of in teh future

---
yes, let's do that and delete applyActionListDiff

I love that maybe we can yeah deleete sync andmake plan.ts perfect
---
1.
Existing event payloads can still serialize to string at the edge.
Whats this mean? When would we need to do that?

2. 
Sure. What happens if preread with trust is passed in- it just skips the preread? That would make a lot more sense to split the things either way to split the scope

3. Ok...... not 100% sure abt this  but possibly?
4. Uh huh tell me more
5. ew
6. also is conditions drifting from actions

---
1. Yeah i mean why does ui need simple strings

2. Ok perf

3. Ok

4. What even is context i always see it for as long as ive been coding like discord.py ctx and in this repo task ctx but i always just assume its some state carrier

5. feel free to remove any comments u see fit

6. we def need to not have sync in conditions tho prolly right?
ooh yeah u said that
def no prereading condition list lowkey i mean like conditions are just called in ONE path in actions maybe it would be better to nest /conditions/ inside of /actions? and simplify whatever we can? i mean it is a subset- idk.

---
1.
The UI does not inherently need simple strings. It needs stable identifiers it can compare/display. Today that happens to be strings like "5.ifActions". A typed ActionPath could flow through events too; only actual display/debug text needs string formatting.

Where does it display this?
I'm so confused

3. okay, and is that what we have?

4. Are you sure? I mean- it is only used through actions in one specific place (conditionals)



---
Can you please help me start thinkinig about how to make the exporter work with the Queue without ruining all of our beautiful code for importing (like readOnly)- not sure how it works right now but yeah. for example for export all functions it would preread all funtions and do a queue thing and in this i'd also like to revamp the Knowledge pane a lot to make it actually useful. Take a look at Tqol terra's qol on github if you can find it and feel free to git clone it to borrow code (hes a friend) but basically waht it does is it is a list of all the functions in the house, it tracks when functions names are edited/deleted and has a bunch of quality of life features for editing things and that would be a perfect fit for the knwoledge pane where i'd like a dropdown to select between known houses but obviously selected mainly is the one that we're in right now and what it does is it should have like the ability to click throuhg mabye tabs of each importable type to see the current houses functions/events/menus and it will have the knowledge dot obviously and then the ability to export a function/whatever and stuff

Tell me more about what we actually are unifying? where is the dispatch layer? what does it do? what files are they? what's the issue

Thats a lot of slashes for one shared runner/TaksContext/waitForMenu/progress/cancel path

Okay yeah you can feel free to clone the repo to a scratch dir just do more investigation


Okay so what you're saying is that the dispatcher ofr startImport acutally does stuff and the other dispatchers dont okay sure

issues:
1. Yeah...... um idk what to do about this tbh
2. that seems probably bad that they're all inlined, a dispatcher file could be good?

Cool uh yeah i mean can you go deper on the per-type config for the knowldge browser? Id love if you could use less buzzwords
---
-------------- TODO ---------------
GH issue 58: Exclude the 9th hotbar slot from all import operations
GH issue 57: During import, it sometimes fails to switch to the first slot ??
GH issue 56: Don't spawn items at the start unless they have code to import
GH issue 55: Import doesn't wait for /gmc to take effect before spawning first item
GH Issue 54: Imports can fail when actions reference teams that don't exist
GH Issue 53: Show diagnostics in the view pane when a file has an error
GH issue 52: figure out other non-spawnable blocks
GH Issue 51: Field leak: diff sees a property scalarFieldDiffers doesn't- genuinely have no clue what this is
GH issue 49: Revamp Knowledge Page- make it like tqol
GH issue 48: Rename ct_module/src/importer/ — directory name lies about ownership

Future: Share knowledge cache with the legendarygames.dev website for coop developemtn
