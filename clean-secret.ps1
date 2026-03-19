$ErrorActionPreference = "Stop"

$repo = "C:\Users\2k22c\Desktop\PlacmentProjects\RateForge"
Set-Location $repo

# Create the sequence editor script
$editorScript = "C:\Users\2k22c\Desktop\PlacmentProjects\RateForge\seq-editor.ps1"
@"
`$file = `$args[0]
(Get-Content `$file) -replace 'pick f9481ed', 'edit f9481ed' | Set-Content `$file
"@ | Out-File -FilePath $editorScript -Encoding UTF8

# Run rebase
$env:GIT_SEQUENCE_EDITOR = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$editorScript`""
git rebase -i HEAD~3

# Now we should be stopped at f9481ed
if (Test-Path "k8s/secret.yaml.template") {
    (Get-Content "k8s/secret.yaml.template") -replace 'T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX', 'TXXXXXXXXX/BXXXXXXXXX/replace-with-real-webhook' | Set-Content "k8s/secret.yaml.template"
    git add "k8s/secret.yaml.template"
    git commit --amend --no-edit
}

# Continue rebase
git rebase --continue

# Cleanup
$env:GIT_SEQUENCE_EDITOR = ""
Remove-Item $editorScript -Force
