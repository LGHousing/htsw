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

1. Smh- okay, yeah that def needs to be moved

2. Bruh. remove that shit
Ok cool! still a terrible spot for it- also what tell me about the two representations in one file
okay... colocation is a scary word!! jk idk um yeah 

3. oh the TABS you can right lcick on the tabs?

6. Cool

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



--------

okay and where is previewLine populated from?

Thats weird why does rep b exist cant we just edit rep a


Erm when you get a chance can you take a look at the barrel for index.ts in state im confused why we still have it and this freaky stuff // Cross-area re-exports kept so existing `from "../state"` call sites resolve
// without churn. Owners: knowledge rows live in `gui/knowledge/`, import-session
// progress in `gui/right-panel/import-tab/`.
export * from "../knowledge/rows";
export * from "../right-panel/import-tab/importProgress";



-------------------
Maybe- just- on failure can we save what existed? is that a bad idea? im
     confused what scope A does. what are yous aying about scope b i shard? i dont
     want a new *.progerss.json at all that sounds like a terrible idea- but we can
     just save what we know is in housing righ tnow, right? like observed is always
     observed, all updates only make it more accurate to what's in housing  i dont
     think the right wording is to "invalidate it" after we start phase 2 applying
     its just to save the knowledge cahce well but thats like prettty performance
     intesnive if we save teh cache after each edit maybe so idk just like a save
     after phase 1 idk and if it fails... uhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh well idk

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