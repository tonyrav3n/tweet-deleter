# Tweet Cleaner

> Helps with tweet cleaning.

## Precautions

- Due to Twitter's tweet loading characteristics, you need to **run it multiple times** to delete everything.

- Tweets before April 2025 may not be deleted due to Twitter API's own updates. (Not tested, but there have been reports that they are deleted)

- Removed the date filter that wasn't working in version 1.3.

- Referenced code from <https://github.com/Lyfhael/DeleteTweets>.

## Installation Method

All responsibility for using this software lies with the **user**.

A kind person added a friendly guide, so I'm attaching it.

<https://x.com/SUNAEOJISANG/status/1936707317405528150>

1. Click the green button on the right in GitHub, and click "Download ZIP" that appears below.

2. Extract the downloaded ZIP file.

3. Open developer mode in Chrome or Edge browser's extension menu and load the downloaded extension.

   - For Chrome: chrome://extensions

   - For Edge: edge://extensions

   Enter this in the address bar to navigate

4. Enable "Developer mode". Then click "Load Unpacked".

5. Select the folder where the manifest.json file is located from the extracted folder or its subfolders.

6. Confirm that the extension is installed properly.

## Usage Method

1. Go to the reply tab (your profile > replies).

2. Wait until the replies are fully loaded and click the extension button.

3. Keep it as is. You can check the progress by pressing F12 to open developer tools > console.

## Contributing

- It doesn't work / This should be improved / Wrong deletion happened -> Feedback is also welcome!

- It's at PoC level beta testing stage. Especially the filtering function may have errors. Please use it with some risk tolerance.

- Feel free to open issues, contribute, or contact via Twitter DM @booleanistic.

## TODO

- [ ] Test cleaning old tweets
- [ ] Filter tweets not to delete by favoriting them
- [ ] Add progress bar to frontend
- [ ] Various UI/UX improvements
- [x] Improve 404 error retry to not be too slow
- [ ] Improve the issue where non-existent tweets are counted
