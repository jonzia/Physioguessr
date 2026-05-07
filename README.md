# Physioguessr

## Accessing Physioguessr
Physioguessr is live at [physioguessr.com](https://physioguessr.com) (or [neuroguessr.com](https://neuroguessr.com) if you prefer) and is accessible on desktop and laptop browsers and mobile devices. Physioguessr is free and open source on Github with backend hosted on Firebase servers.

## Contents
1. [Creating & Editing Question Sets](#creating-and-editing-question-sets)
2. [Using Physioguessr for Presentations](#using-physioguessr-for-presentations)
3. [Gameplay Mechanics](#gameplay-mechanics)
4. [Computer vs. Phone Gameplay](#computer-vs-phone-gameplay)
5. [Game Modes](#game-modes)

## Creating and Editing Question Sets

1. Log in with Google account.
2. An option will pop up at the bottom of the main menu to `Manage Question Sets`.
3. After clicking, you will be able to Add, Edit, or Delete a question set.
4. When making a question, you will enter the clinical prompt, which the user will see before guessing. You will also specify the anatomical location description, in which you can also provide justification for the answer. Then select a target on the MRI to serve as the ground truth.
5. Don’t forget to save changes when done editing a question set.

Question sets are private by default, meaning they can only be accessed for editing or gameplay when logged into your Google account. Others are not able to view, manage, or play the set. 

## Using Physioguessr for Presentations
1. `Create Private Room` -> `Enable Presenter Mode`: This is a casual game mode without a timer, and guests can pop in and out during the game. In the standard competitive mode, there is a round timer and guests cannot rejoin if they disconnect.
2. Select a question set, from Physioguessr public sets or your own private sets if logged in.
4. Click `Start Game` to start game for all users once they have joined.

## Gameplay Mechanics
1. To find the right MRI slice, computer users can scroll up and down on the brain image or drag the scroll bar. Phone users can drag the scroll bar located below the image.
2. To register a guess, tap or click on the image once you have reached the desired slice and select `Submit Guess`.
3. If the timer runs out (in competitive mode) or the host selects “Continue” (in presenter mode), a guess will not be registered.

## Computer vs Phone Gameplay
Phones can only join private rooms to participate in games. Phone users don’t see question prompts, so this is intended for use in Presenter Mode or for LAN matches with at least one desktop user. Computer users see the full user interface in all game modes. Note that if computer users resize their browser window to a narrow display, it will change to a mobile user interface since the full GUI cannot be accomodated. 

## Game Modes

| Mode | Description |
| -------- | -------- |
| Matchmaking (`Find Match`) | You will be paired with a random opponent in a private PvP match. For now, users will compete on random a random selection from the default question set. |
| Competitive Private Match (`Create Private Room` or `Join Private Room`) | Create a private match, or join by entering the provided room code. The host will select a question set and time limit for the round. The host clicking `Start Game` will start the game for all. The host or all guests leaving will end the game, and guests who leave cannot rejoin. Guesses must be submitted before the round timer runs out, else a guess is not recorded for the user. |
| Presenter Mode (`Create Private Room` -> `Enable Presenter Mode`) | Create a private match, or join by entering the provided room code. The host will select a question set and there is no time limit for the round. The host clicking `Start Game` will start the game for all. The host leaving will end the game, though guests can come and go during the game. Guesses must be submitted before the host clicks `Continue`, else a guess is not recorded for the user. |
| Single Player (`Single Player`) | Creates a private solo match. The user can specify a question set (either a public set or their own private set). There is no round timer. Other users cannot view or join the match. |

## Disclaimer

This platform is for entertainment purposes only, the content of which should not be used for medical decision making or taken as medical advice. I do not moderate content posted by users to this platform, and therefore content on this platform does not reflect my personal or medical opinion and does not have my endorsement.
